import { Plugin } from '@opencode/plugin'
import { createService } from './core.js'
import { directCompletion } from './judge.js'
import { loginPoll, loginStart } from './login.js'
import { fetchMutualFriends } from './weibo.js'
import { createMemoryStore } from './memory.js'
import { Weibo } from './rpc.js'
import { loadSettings, normalizePatch, publicSettings, saveSettings } from './settings.js'
import { loadState, saveState } from './state.js'

const PLUGIN_ID = 'foxy-weibo'
const EMPTY_INPUT = { type: 'object', properties: {}, additionalProperties: false }
const MAX_POSTS_INPUT = {
  type: 'object',
  properties: {
    maxPosts: { type: 'integer', minimum: 1, maximum: 100 },
    postId: { type: 'string' },
  },
  additionalProperties: false,
}

function toolText(value) {
  return { content: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }
}

function describeError(error) {
  return error?.message || String(error)
}

function withTimeout(promise, ms, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    timer.unref?.()
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

function nextScheduleDelay(scheduleTimes) {
  const times = Array.isArray(scheduleTimes) ? scheduleTimes : []
  if (!times.length) return Infinity
  const now = new Date()
  let best = Infinity
  for (const text of times) {
    const [hour, minute] = String(text).split(':').map(Number)
    if (!Number.isInteger(hour) || !Number.isInteger(minute)) continue
    for (let day = 0; day <= 1; day += 1) {
      const at = new Date(now)
      at.setDate(now.getDate() + day)
      at.setHours(hour, minute, 0, 0)
      const delay = at.getTime() - now.getTime()
      if (delay > 0 && delay < best) best = delay
    }
  }
  return Number.isFinite(best) ? best : Infinity
}

/**
 * Use the model selected in OpenCode, without requiring a separate API key.
 * `experimental.generate.text` avoids creating a session; the session fallback
 * keeps older 2.x builds working.
 */
function parseModelRef(value) {
  const text = String(value || '').trim()
  if (!text) return null
  const index = text.indexOf('/')
  if (index <= 0 || index === text.length - 1) return null
  return { providerID: text.slice(0, index), id: text.slice(index + 1) }
}

async function openCodeGenerate(ctx, state, prompt, preferred) {
  if (ctx.experimental?.generate?.text) {
    let ref = parseModelRef(preferred)
    if (!ref) {
      const selected = await ctx.model.default()
      if (!selected) throw new Error('OpenCode 没有可用模型，请先在设置中选择模型')
      // 2.x returns { location, data: Model.Info }; older builds return Model.Ref.
      const info = selected.data || selected
      ref = { providerID: info.providerID, id: info.modelID || info.id }
    }
    if (!ref?.providerID || !ref?.id) {
      throw new Error('模型配置无效，请在微博设置的“使用的模型”中重新选择')
    }
    const result = await withTimeout(
      ctx.experimental.generate.text({
        model: ref,
        prompt,
      }),
      120_000,
      '模型调用超时（120 秒）',
    )
    return String(typeof result === 'string' ? result : (result?.text ?? '')).trim()
  }

  if (typeof ctx.session?.generate === 'function') {
    let sessionID = state.judgeSessionId
    if (!sessionID) {
      const session = await ctx.session.create({ title: '微博判断' })
      sessionID = session.id
      state.judgeSessionId = sessionID
      saveState(state)
    }
    const result = await ctx.session.generate({ sessionID, prompt })
    return String(result?.text || '').trim()
  }

  throw new Error('当前 OpenCode 版本不支持复用模型，请切换到直连 API 模式')
}

function makeCompleter(ctx, config, state) {
  return async ({ system, user, maxTokens = 1200, temperature = 0.8 }) => {
    if (config.llmMode === 'direct' && config.llmApiKey) {
      return directCompletion(config, system, user, { maxTokens, temperature })
    }
    const prompt = system ? `${system}\n\n${user}` : user
    try {
      const text = await openCodeGenerate(ctx, state, prompt, config.model)
      if (!text) throw new Error('OpenCode 模型返回为空')
      return text
    } catch (error) {
      if (config.llmApiKey) {
        return directCompletion(config, system, user, { maxTokens, temperature })
      }
      throw error
    }
  }
}

async function assertPublishPermission(ctx, context, input, action = 'weibo.comment') {
  if (typeof ctx.permission?.assert !== 'function') return
  await ctx.permission.assert({
    sessionID: context.sessionID,
    agent: context.agent,
    source: { type: 'tool', messageID: context.messageID, id: context.id },
    action,
    resources: [String(input?.postId || input?.cid || input?.uid || 'target')],
  })
}

async function assertCommentPermission(ctx, context, input) {
  return assertPublishPermission(ctx, context, input, 'weibo.comment')
}

export default Plugin.define({
  id: PLUGIN_ID,
  async setup(ctx) {
    const config = loadSettings(ctx.options || {})
    const state = loadState()
    const memory = createMemoryStore(config)
    const log = (message) => console.log(message)
    let nextRunAt = 0
    let nextPostAt = 0
    let nextDmAt = 0
    let postRetry = null

    const runtime = {
      complete: makeCompleter(ctx, config, state),
      memory,
      log,
      saveSettings: () => saveSettings(config),
      search: async (query) => {
        if (typeof ctx.websearch?.query !== 'function') {
          throw new Error('当前 OpenCode 未提供联网搜索')
        }
        const result = await withTimeout(
          ctx.websearch.query({ location: ctx.location, query }),
          25_000,
          '联网搜索超时（25 秒）',
        )
        const payload = result?.data ?? result
        return Array.isArray(payload?.results) ? payload.results : []
      },
    }

    const service = createService({
      config,
      state,
      runtime,
      getNextRunAt: () => nextRunAt,
      getNextPostAt: () => nextPostAt,
      getNextDmAt: () => nextDmAt,
    })

    let ticker
    let startTimer
    // A wall-clock tick instead of one long setTimeout: after the Mac sleeps
    // through a scheduled time the overdue job still runs on the next tick.
    // The settings file is re-read every tick so a reloaded or stale instance
    // cannot keep posting with an old schedule or an old enable flag.
    const nextDelay = (times) => {
      const delay = nextScheduleDelay(times)
      return Number.isFinite(delay) ? Date.now() + delay : 0
    }
    const reschedule = () => {
      nextRunAt = nextDelay(config.scheduleTimes)
      nextPostAt = nextDelay(config.postTimes)
      nextDmAt = nextDelay(config.dmTimes)
    }
    reschedule()

    const slotKey = (at) => {
      const date = new Date(at)
      const pad = (value) => String(value).padStart(2, '0')
      return (
        `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
        `${pad(date.getHours())}:${pad(date.getMinutes())}`
      )
    }

    const tick = () => {
      const now = Date.now()
      const previousScan = JSON.stringify(config.scheduleTimes)
      const previousPost = JSON.stringify(config.postTimes)
      const previousDm = JSON.stringify(config.dmTimes)
      try {
        Object.assign(config, loadSettings())
      } catch {
        // Keep the in-memory settings when the file is temporarily unreadable.
      }
      if (JSON.stringify(config.scheduleTimes) !== previousScan) {
        nextRunAt = nextDelay(config.scheduleTimes)
      }
      if (JSON.stringify(config.postTimes) !== previousPost) {
        nextPostAt = nextDelay(config.postTimes)
      }
      if (JSON.stringify(config.dmTimes) !== previousDm) {
        nextDmAt = nextDelay(config.dmTimes)
      }

      if (nextRunAt && now >= nextRunAt) {
        nextRunAt = nextDelay(config.scheduleTimes)
        if (config.enabled) service.run('schedule').catch(() => {})
      }
      if (nextPostAt && now >= nextPostAt) {
        const slot = postRetry?.slot || slotKey(nextPostAt)
        const previousAttempts = postRetry?.attempts || 0
        postRetry = null
        nextPostAt = nextDelay(config.postTimes)
        if (config.postEnabled) {
          service
            .postNow({ slot })
            .then((result) => {
              const attempts = Number(result?.attempts || previousAttempts + 1) || 1
              // Generation/search timeouts are transient: retry the same
              // slot up to 3 attempts, 10 minutes apart. Publish errors are
              // not retried because the status may already exist.
              if (result?.stage === 'generate' && attempts < 3) {
                postRetry = { slot, attempts }
                nextPostAt = Date.now() + 10 * 60_000
              }
            })
            .catch(() => {})
        }
      }
      if (nextDmAt && now >= nextDmAt) {
        const slot = slotKey(nextDmAt)
        nextDmAt = nextDelay(config.dmTimes)
        if (config.dmEnabled) service.dmNow({ slot }).catch(() => {})
      }
    }

    ticker = setInterval(tick, 15_000)
    ticker.unref?.()
    ctx.onCleanup?.(() => clearInterval(ticker))

    if (config.runOnStart) {
      startTimer = setTimeout(() => service.run('start').catch(() => {}), 20_000)
      startTimer.unref?.()
      ctx.onCleanup?.(() => clearTimeout(startTimer))
    }

    const toolRegistration = await ctx.tool.transform((editor) => {
      editor.namespace({
        name: 'weibo',
        description: '微博：读取目标账号博文、判断是否评论、发布评论/楼中楼、提取长期记忆',
      })

      editor.add({
        name: 'status',
        description: '查看微博插件的登录状态、今日评论数、上次运行结果和最近记录。',
        input: EMPTY_INPUT,
        options: { namespace: 'weibo', codemode: true },
        execute: async () => toolText({ ok: true, status: service.status(), settings: publicSettings(config) }),
      })

      editor.add({
        name: 'check',
        description: '只拉取并检查目标账号最近的博文，不写记忆、不评论。',
        input: MAX_POSTS_INPUT,
        options: { namespace: 'weibo', codemode: true },
        execute: async (input) => toolText({ ok: true, result: await service.checkNow(input) }),
      })

      editor.add({
        name: 'read',
        description: '读取目标账号最近的博文并写入本地长期记忆，按博文 ID 去重。',
        input: MAX_POSTS_INPUT,
        options: { namespace: 'weibo', codemode: true },
        execute: async (input) => toolText({ ok: true, result: await service.readNow(input) }),
      })

      editor.add({
        name: 'comment',
        description: '对目标账号的一篇博文发表一级评论。会真实发布到微博，调用前会请求权限。',
        input: {
          type: 'object',
          properties: {
            postId: { type: 'string', description: '博文 ID；留空时选择最近一篇可评论博文' },
            maxPosts: { type: 'integer', minimum: 1, maximum: 100 },
          },
          additionalProperties: false,
        },
        options: { namespace: 'weibo', codemode: true },
        execute: async (input, context) => {
          await assertCommentPermission(ctx, context, input)
          return toolText({
            ok: true,
            result: await service.replyNow('', String(input.postId || ''), {
              maxPosts: input.maxPosts,
            }),
          })
        },
      })

      editor.add({
        name: 'reply',
        description: '回复自己微博评论下的楼中楼。cid 是 Foxy 自己那条评论的 ID；会真实发布到微博。',
        input: {
          type: 'object',
          properties: {
            cid: { type: 'string', description: 'Foxy 自己评论的 cid' },
            postId: { type: 'string', description: '限定博文 ID' },
            maxPosts: { type: 'integer', minimum: 1, maximum: 100 },
          },
          additionalProperties: false,
        },
        options: { namespace: 'weibo', codemode: true },
        execute: async (input, context) => {
          await assertCommentPermission(ctx, context, input)
          return toolText({
            ok: true,
            result: await service.replyNow(String(input.cid || ''), String(input.postId || ''), {
              maxPosts: input.maxPosts,
            }),
          })
        },
      })

      editor.add({
        name: 'post',
        description: '按“发博关键词/要求”生成并发布一条微博。会真实发布到微博，调用前会请求权限。',
        input: {
          type: 'object',
          properties: {
            prompt: { type: 'string', description: '临时覆盖设置里的发博关键词/要求' },
          },
          additionalProperties: false,
        },
        options: { namespace: 'weibo', codemode: true },
        execute: async (input, context) => {
          await assertPublishPermission(ctx, context, input, 'weibo.post')
          return toolText({ ok: true, result: await service.postNow({ prompt: input?.prompt }) })
        },
      })

      editor.add({
        name: 'dm',
        description: '给互关好友发送私信（会真实发送）。uid 留空时发给设置里选中的好友。',
        input: {
          type: 'object',
          properties: {
            uid: { type: 'string', description: '好友 UID；留空发给设置里选中的所有好友' },
            text: { type: 'string', description: '私信内容；留空使用设置里的内容' },
          },
          additionalProperties: false,
        },
        options: { namespace: 'weibo', codemode: true },
        execute: async (input, context) => {
          await assertPublishPermission(ctx, context, input, 'weibo.dm')
          return toolText({
            ok: true,
            result: await service.dmNow({ targets: input?.uid, message: input?.text }),
          })
        },
      })

      editor.add({
        name: 'extract',
        description: '一次性读取全部往期博文，按周/月/年分组提炼长期记忆。只读不评论，后台运行。',
        input: EMPTY_INPUT,
        options: { namespace: 'weibo', codemode: true },
        execute: async () => toolText({ ok: true, result: service.startExtract() }),
      })

      editor.add({
        name: 'memory',
        description: '搜索插件写入的微博长期记忆。',
        input: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            limit: { type: 'integer', minimum: 1, maximum: 50 },
          },
          additionalProperties: false,
        },
        options: { namespace: 'weibo', codemode: true },
        execute: async (input) =>
          toolText({
            ok: true,
            file: memory.file,
            items: await memory.search(String(input.query || ''), Number(input.limit) || 5),
          }),
      })
    })

    const rpcRegistration = await ctx.rpc.register(Weibo, {
      status: async () => ({
        ok: true,
        status: service.status(),
        settings: publicSettings(config),
      }),

      update: async (input) => {
        const patch = input?.patch && typeof input.patch === 'object' ? input.patch : {}
        const beforePrompt = String(config.postPrompt || '').trim()
        Object.assign(config, normalizePatch(config, patch))
        if (String(config.postPrompt || '').trim() !== beforePrompt) {
          config.postPromptOptimized = ''
          config.postPromptOptimizedFor = ''
        }
        saveSettings(config)
        reschedule()
        return { ok: true, status: service.status(), settings: publicSettings(config) }
      },

      friends: async () => ({ ok: true, friends: await fetchMutualFriends(config) }),

      models: async () => {
        const raw = await ctx.model.list({ types: ['chat'] })
        const list = Array.isArray(raw) ? raw : (raw?.data ?? [])
        const models = list
          .filter((item) => item && item.providerID && (item.modelID || item.id))
          .map((item) => {
            const id = item.modelID || item.id
            return {
              id: `${item.providerID}/${id}`,
              name: item.name || id,
              provider: item.providerID,
            }
          })
        return { ok: true, models }
      },

      loginStart: async () => ({ ok: true, ...(await loginStart()) }),

      loginPoll: async (input) => {
        const result = await loginPoll(input?.qrid)
        if (result.state === 'ok' && result.cookie) {
          config.cookie = result.cookie
          config.accountName = result.account?.screenName || ''
          config.accountUid = result.account?.uid || ''
          saveSettings(config)
        }
        return {
          ok: true,
          ...result,
          settings: publicSettings(config),
          status: service.status(),
        }
      },

      logout: async () => {
        config.cookie = ''
        config.accountName = ''
        config.accountUid = ''
        saveSettings(config)
        return { ok: true, settings: publicSettings(config), status: service.status() }
      },

      run: async (input) => {
        const mode = String(input?.mode || 'run')
        let result
        if (mode === 'check') result = await service.checkNow()
        else if (mode === 'read') result = await service.readNow()
        else if (mode === 'reply') {
          result = await service.replyNow(String(input?.cid || ''), String(input?.postId || ''))
        } else if (mode === 'post') {
          result = await service.postNow({ prompt: input?.prompt })
        } else if (mode === 'dm') {
          result = await service.dmNow()
        } else if (mode === 'extract') result = service.startExtract()
        else result = await service.run('manual', true)
        return { ok: true, result, status: service.status() }
      },
    })

    log(
      `[foxy-weibo] ready enabled=${config.enabled} target=${config.targetUid || 'unset'} ` +
        `times=${config.scheduleTimes.join(',')} reply=${config.replyMode} ` +
        `post=${config.postEnabled ? config.postTimes.join(',') : 'off'} ` +
        `dm=${config.dmEnabled ? config.dmTimes.join(',') : 'off'} model=${config.model || config.llmMode}`,
    )

    return () => {
      clearTimeout(timer)
      clearTimeout(startTimer)
      Promise.resolve(rpcRegistration?.dispose?.()).catch(() => {})
      Promise.resolve(toolRegistration?.dispose?.()).catch(() => {})
    }
  },
})

export { createService, groupPostsByUnit, scanNestedReplies, scanTargetPosts, extractMemories } from './core.js'
export { DEFAULTS, normalizePatch, publicSettings, loadSettings, saveSettings } from './settings.js'
export { loadState, saveState } from './state.js'
