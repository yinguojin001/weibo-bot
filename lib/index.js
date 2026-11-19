import { Plugin } from '@opencode/plugin'
import { createService } from './core.js'
import { directCompletion } from './judge.js'
import { loginPoll, loginStart } from './login.js'
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

function nextScheduleDelay(scheduleTimes) {
  const times = Array.isArray(scheduleTimes) ? scheduleTimes : []
  if (!times.length) return 60 * 60 * 1000
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
  return Number.isFinite(best) ? best : 60 * 60 * 1000
}

/**
 * Use the model selected in OpenCode, without requiring a separate API key.
 * `experimental.generate.text` avoids creating a session; the session fallback
 * keeps older 2.x builds working.
 */
async function openCodeGenerate(ctx, state, prompt) {
  if (ctx.experimental?.generate?.text) {
    const selected = await ctx.model.default()
    if (!selected) throw new Error('OpenCode 没有可用模型，请先在设置中选择模型')
    // 2.x returns { location, data: Model.Info }; older builds return Model.Ref.
    const info = selected.data || selected
    const providerID = info.providerID
    const id = info.modelID || info.id
    const result = await ctx.experimental.generate.text({
      model: { providerID, id },
      prompt,
    })
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
      const text = await openCodeGenerate(ctx, state, prompt)
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

async function assertCommentPermission(ctx, context, input) {
  if (typeof ctx.permission?.assert !== 'function') return
  await ctx.permission.assert({
    sessionID: context.sessionID,
    agent: context.agent,
    source: { type: 'tool', messageID: context.messageID, id: context.id },
    action: 'weibo.comment',
    resources: [String(input?.postId || input?.cid || 'target')],
  })
}

export default Plugin.define({
  id: PLUGIN_ID,
  async setup(ctx) {
    const config = loadSettings(ctx.options || {})
    const state = loadState()
    const memory = createMemoryStore(config)
    const log = (message) => console.log(message)
    let nextRunAt = 0

    const runtime = {
      complete: makeCompleter(ctx, config, state),
      memory,
      log,
    }

    const service = createService({
      config,
      state,
      runtime,
      getNextRunAt: () => nextRunAt,
    })

    let timer
    let startTimer
    const restartTimer = () => {
      clearTimeout(timer)
      const delay = nextScheduleDelay(config.scheduleTimes)
      nextRunAt = Date.now() + delay
      timer = setTimeout(async () => {
        await service.run('schedule').catch(() => {})
        restartTimer()
      }, delay)
      timer.unref?.()
    }
    restartTimer()

    if (config.runOnStart) {
      startTimer = setTimeout(() => service.run('start').catch(() => {}), 20_000)
      startTimer.unref?.()
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
        Object.assign(config, normalizePatch(config, patch))
        saveSettings(config)
        restartTimer()
        return { ok: true, status: service.status(), settings: publicSettings(config) }
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
        } else if (mode === 'extract') result = service.startExtract()
        else result = await service.run('manual', true)
        return { ok: true, result, status: service.status() }
      },
    })

    log(
      `[foxy-weibo] ready enabled=${config.enabled} target=${config.targetUid || 'unset'} ` +
        `times=${config.scheduleTimes.join(',')} reply=${config.replyMode} model=${config.llmMode}`,
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
