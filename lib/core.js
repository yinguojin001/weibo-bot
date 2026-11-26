import {
  fetchChildComments,
  fetchComments,
  fetchTimeline,
  postComment,
  postStatus,
  postSummary,
  sendDirectMessage,
} from './weibo.js'
import {
  fallbackPostMemory,
  generatePostText,
  judgePost,
  optimizePostPrompt,
  summarizePostMemory,
  summarizeRange,
} from './judge.js'
import { fetchAccount } from './login.js'
import {
  acquireStateLock,
  bumpComments,
  commentCount,
  debugLog,
  loadState,
  pushHistory,
  releaseStateLock,
  saveState,
} from './state.js'

const ACTION_LABELS = {
  skip: '跳过',
  remember: '记录',
  comment: '评论',
  reply: '回复',
  'pending-reply': '待回复',
  error: '失败',
}

function firstLine(text, limit = 120) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, limit)
}

function entryReason(decision) {
  return (
    String(decision?.mood || decision?.memory || decision?.reason || '').trim() ||
    '模型判断不需要评论'
  )
}

async function rememberReply(runtime, config, state, post, comment, replyText) {
  if (!config.enableMemory) return { ok: false, reason: 'disabled' }
  if (!runtime.memory?.record) return { ok: false, reason: 'no-provider' }
  const person = comment.author?.name || comment.author?.uid || '一位网友'
  const text = `我在微博回复了 ${person} 在自己博文「${firstLine(post.text, 60)}」下的评论：${replyText}`
  try {
    await runtime.memory.record({
      role: 'assistant',
      text,
      sessionId: `weibo-comment:${post.id}:${comment.cid}`,
      platform: 'weibo',
      speakerKey: comment.author?.uid ? `weibo:${comment.author.uid}` : undefined,
      speakerLabel: comment.author?.name || undefined,
      sourceLabel: '微博评论回复',
      eventType: 'weibo_reply',
      channelType: 'weibo_comment',
      channelId: String(comment.cid),
      title: firstLine(post.text, 120),
      url: post.url,
      scene: 'weibo',
    })
    debugLog(state, config, { kind: 'memory', post: post.id, memory: 'written', text: firstLine(text, 300) })
    return { ok: true, reason: 'written', text }
  } catch (error) {
    const reason = error?.message || String(error)
    debugLog(state, config, { kind: 'memory', post: post.id, memory: 'error', reason })
    return { ok: false, reason }
  }
}

async function rememberPost(runtime, config, state, post) {
  if (!config.enableMemory || config.learnPosts === false) {
    return { ok: false, reason: 'disabled' }
  }
  if (state.postMemory?.[post.id]) return { ok: false, reason: 'already' }
  if (!runtime.memory?.record) return { ok: false, reason: 'no-provider' }
  const excerpt = firstLine(post.text, 180)
  const text = (await summarizePostMemory(config, post, runtime.complete)) || fallbackPostMemory(post)
  try {
    await runtime.memory.record({
      role: 'assistant',
      text,
      sessionId: `weibo-post:${post.id}`,
      platform: 'weibo',
      speakerKey: post.author?.uid ? `weibo:${post.author.uid}` : undefined,
      speakerLabel: post.author?.name || undefined,
      sourceLabel: '目标账号博文',
      eventType: 'weibo_owner_post',
      channelType: 'weibo_post',
      channelId: post.id,
      title: excerpt,
      url: post.url,
      scene: 'weibo',
    })
    state.postMemory = state.postMemory || {}
    state.postMemory[post.id] = Date.now()
    debugLog(state, config, {
      kind: 'memory',
      post: post.id,
      memory: 'written',
      eventType: 'weibo_owner_post',
      text: firstLine(text, 300),
    })
    return { ok: true, reason: 'written', text }
  } catch (error) {
    const reason = error?.message || String(error)
    debugLog(state, config, { kind: 'memory', post: post.id, memory: 'error', reason })
    return { ok: false, reason }
  }
}

export async function scanNestedReplies(
  config,
  state,
  runtime,
  posts,
  loginUid,
  memoryContext = '',
  options = {},
) {
  const result = { checked: 0, replied: 0, skipped: 0, errors: 0, items: [] }
  if (!config.replyNested) return result
  const dryRun = options.dryRun === true
  const targetCid = String(options.cid || '')
  for (const post of posts) {
    let comments = []
    try {
      comments = await fetchComments(post.mid || post.id, config, 50)
    } catch (error) {
      result.errors += 1
      debugLog(state, config, {
        kind: 'nested-fetch',
        post: post.id,
        reason: error?.message || String(error),
      })
      continue
    }

    const botCids = new Set()
    const knownCid = String(state.postSeen?.[post.id]?.commentId || '')
    if (knownCid) botCids.add(knownCid)
    if (targetCid) botCids.add(targetCid)
    for (const comment of comments) {
      if (String(comment.author?.uid || '') === loginUid) botCids.add(comment.cid)
    }
    if (!botCids.size) continue

    const children = []
    for (const cid of botCids) {
      try {
        children.push(...(await fetchChildComments(cid, config, 50)))
      } catch (error) {
        debugLog(state, config, {
          kind: 'nested-child-fetch',
          post: post.id,
          comment: cid,
          reason: error?.message || String(error),
        })
      }
    }

    const pool = [...comments, ...children]
    const thread = new Set(botCids)
    let changed = true
    while (changed) {
      changed = false
      for (const comment of pool) {
        if (!comment.cid || thread.has(comment.cid)) continue
        if (thread.has(String(comment.rootid)) || thread.has(String(comment.replyid))) {
          thread.add(comment.cid)
          changed = true
        }
      }
    }

    const candidates = Array.from(
      new Map(
        pool
          .filter(
            (comment) =>
              comment.cid &&
              thread.has(comment.cid) &&
              !botCids.has(comment.cid) &&
              String(comment.author?.uid || '') !== loginUid &&
              !state.commentSeen?.[comment.cid],
          )
          .map((comment) => [comment.cid, comment]),
      ).values(),
    )
    for (const comment of candidates.slice(0, 2)) {
      result.checked += 1
      if (dryRun) {
        const entry = {
          at: Date.now(),
          kind: 'weibo-nested-check',
          postId: post.id,
          title: firstLine(post.text, 80),
          url: post.url,
          author: comment.author.name,
          action: 'pending-reply',
          text: firstLine(comment.text, 160),
          commentId: comment.cid,
          createdAt: comment.createdAt,
        }
        result.items.push(entry)
        continue
      }
      try {
        const decision = await judgePost(
          config,
          {
            summary: postSummary(post),
            comments: [],
            commentsText: '',
            targetComment: comment,
            memoryContext,
            mayComment: true,
            mayReply: true,
            forceComment: false,
          },
          runtime.complete,
        )
        if (decision.action !== 'comment' || !decision.comment) {
          result.skipped += 1
          state.commentSeen = state.commentSeen || {}
          state.commentSeen[comment.cid] = { status: 'skipped', at: Date.now() }
          continue
        }
        const published = await postComment({
          mid: post.mid || post.id,
          cid: comment.cid,
          text: decision.comment,
          config,
        })
        state.commentSeen = state.commentSeen || {}
        state.commentSeen[comment.cid] = { status: 'replied', at: Date.now() }
        const memory = await rememberReply(runtime, config, state, post, comment, decision.comment)
        const entry = {
          at: Date.now(),
          kind: 'weibo-reply',
          postId: post.id,
          title: firstLine(post.text, 80),
          url: post.url,
          author: comment.author.name,
          action: 'reply',
          comment: decision.comment,
          commentId: published.cid,
          memory: memory.ok ? 'written' : memory.reason,
        }
        pushHistory(state, entry)
        result.items.push(entry)
        result.replied += 1
        bumpComments(state)
        runtime.log(`[foxy-weibo] 回复楼中楼 ${comment.cid}：${firstLine(decision.comment, 80)}`)
        return result
      } catch (error) {
        result.errors += 1
        debugLog(state, config, {
          kind: 'nested-reply',
          post: post.id,
          comment: comment.cid,
          reason: error?.message || String(error),
        })
      }
    }
  }
  return result
}

export async function scanTargetPosts(config, state, runtime, force = false, options = {}) {
  if (!config.enabled && !force) return { skipped: 'disabled' }
  const previewOnly = options.previewOnly === true
  const checkOnly = options.checkOnly === true
  const readOnly = options.readOnly === true
  const forceReply = options.forceReply === true
  const targetCid = String(options.cid || '')
  const targetPostId = String(options.postId || '')
  const canComment = !previewOnly && !checkOnly && !readOnly && (forceReply || config.replyMode === 'auto')
  const targetUid = String(config.targetUid || '').trim()
  const result = {
    mode: options.mode || 'target-posts',
    posts: 0,
    checked: 0,
    commented: 0,
    replied: 0,
    previewed: 0,
    skipped: 0,
    errors: 0,
    memories: 0,
    pendingReplies: 0,
    items: [],
  }
  if (!targetUid) return { ...result, skipped: 'no-target' }
  if (!config.cookie) return { ...result, errors: 1, error: '请先扫码登录微博账号' }
  const account = await fetchAccount(config.cookie)
  if (!account.uid) return { ...result, errors: 1, error: '微博登录态无效，请重新扫码登录后再检查' }
  const loginUid = String(config.accountUid || account.uid || '')
  const maxPosts = Math.max(1, Math.min(100, Number(options.maxPosts ?? config.maxPostsPerRun) || 5))
  const cutoff = config.replyAfter ? Date.parse(config.replyAfter) : 0
  const maxComments = Math.max(
    1,
    Math.min(10, Number(options.maxComments ?? config.maxCommentsPerDay) || 1),
  )
  let posts = []
  try {
    posts = await fetchTimeline(targetUid, config, {
      maxPosts,
      maxPages: Math.ceil(maxPosts / 10) + 1,
    })
    result.posts = posts.length
  } catch (error) {
    return { ...result, errors: 1, error: error?.message || String(error) }
  }
  debugLog(state, config, {
    kind: 'timeline',
    targetUid,
    posts: posts.length,
    replyAfter: config.replyAfter || '',
  })

  let memoryContext = ''
  if (!readOnly) {
    try {
      if (runtime.memory?.context) {
        memoryContext = String(
          (await runtime.memory.context({ limit: 8 })) || '',
        ).slice(0, 3000)
      }
    } catch (error) {
      debugLog(state, config, {
        kind: 'memory-context',
        reason: error?.message || String(error),
      })
    }
  }

  if (checkOnly) {
    result.items = posts
      .filter((post) => !targetPostId || post.id === targetPostId)
      .slice(0, 30)
      .map((post) => ({
        postId: post.id,
        title: firstLine(post.text, 80),
        url: post.url,
        createdAt: post.createdAt || '',
        createdAtMs: post.createdAtMs || 0,
        seen: Boolean(state.postSeen?.[post.id]),
        belowCutoff: Boolean(cutoff && post.createdAtMs && post.createdAtMs < cutoff),
      }))
    if (config.replyNested) {
      const nested = await scanNestedReplies(config, state, runtime, posts, loginUid, memoryContext, {
        dryRun: true,
      })
      result.items.push(...nested.items)
      result.checked += nested.checked
      result.pendingReplies = nested.items.filter((item) => item.action === 'pending-reply').length
      result.errors += nested.errors
    }
    state.lastRun = Date.now()
    state.lastResult = result
    return result
  }

  for (const post of posts) {
    if (!post.id) continue
    if (targetPostId && post.id !== targetPostId) continue
    if (readOnly) {
      if (state.postMemory?.[post.id]) continue
      const memory = await rememberPost(runtime, config, state, post)
      if (memory.ok) result.memories += 1
      result.checked += 1
      const entry = {
        at: Date.now(),
        kind: 'weibo-post',
        postId: post.id,
        title: firstLine(post.text, 80),
        url: post.url,
        action: 'read',
        memory: memory.ok ? 'written' : memory.reason,
      }
      pushHistory(state, entry)
      result.items.push(entry)
      continue
    }
    if (state.postSeen?.[post.id]) continue
    if (cutoff && post.createdAtMs && post.createdAtMs < cutoff) continue
    if (canComment && Number(post.commentsCount || 0) > 0) {
      let existing = []
      try {
        existing = await fetchComments(post.mid || post.id, config, 50)
      } catch (error) {
        debugLog(state, config, {
          kind: 'existing-comments',
          post: post.id,
          reason: error?.message || String(error),
        })
      }
      const own = existing.find((comment) => String(comment.author?.uid || '') === loginUid)
      if (own) {
        state.postSeen = state.postSeen || {}
        state.postSeen[post.id] = {
          status: 'commented',
          at: Date.now(),
          commentId: own.cid,
        }
        result.skipped += 1
        debugLog(state, config, {
          kind: 'existing-own-comment',
          post: post.id,
          comment: own.cid,
        })
        continue
      }
    }
    const memory = await rememberPost(runtime, config, state, post)
    if (memory.ok) result.memories += 1
    if (canComment && commentCount(state) >= maxComments) {
      result.skipped += 1
      debugLog(state, config, {
        kind: 'quota',
        post: post.id,
        message: '每日评论额度已用完',
      })
      continue
    }
    result.checked += 1
    let entry
    try {
      const decision = await judgePost(
        config,
        {
          summary: postSummary(post),
          comments: [],
          commentsText: '',
          targetPost: post,
          memoryContext,
          mayComment: true,
          mayReply: false,
          forceComment: forceReply,
        },
        runtime.complete,
      )
      const comment = String(decision.comment || '').trim()
      if (decision.action === 'comment' && comment && canComment) {
        const published = await postComment({ mid: post.mid || post.id, text: comment, config })
        result.commented += 1
        bumpComments(state)
        state.postSeen[post.id] = { status: 'commented', at: Date.now(), commentId: published.cid }
        entry = {
          at: Date.now(),
          kind: 'weibo-post',
          postId: post.id,
          title: firstLine(post.text, 80),
          url: post.url,
          author: post.author.name,
          action: 'comment',
          comment,
          commentId: published.cid,
          memory: memory.ok ? 'written' : memory.reason,
        }
        runtime.log(`[foxy-weibo] 评论博文 ${post.id}：${firstLine(comment, 80)}`)
      } else if (decision.action === 'comment' && comment) {
        result.previewed += 1
        entry = {
          at: Date.now(),
          kind: 'weibo-post',
          postId: post.id,
          title: firstLine(post.text, 80),
          url: post.url,
          author: post.author.name,
          action: 'preview',
          comment,
          memory: memory.ok ? 'written' : memory.reason,
        }
      } else {
        result.skipped += 1
        state.postSeen[post.id] = { status: 'skipped', at: Date.now() }
        entry = {
          at: Date.now(),
          kind: 'weibo-post',
          postId: post.id,
          title: firstLine(post.text, 80),
          url: post.url,
          author: post.author.name,
          action: 'skip',
          reason: entryReason(decision),
          memory: memory.ok ? 'written' : memory.reason,
        }
      }
      debugLog(state, config, {
        kind: 'target-judge',
        post: post.id,
        action: decision.action,
        memory: memory.ok ? 'written' : memory.reason,
        raw: String(decision.raw || '').slice(0, 500),
      })
    } catch (error) {
      result.errors += 1
      entry = {
        at: Date.now(),
        kind: 'weibo-post',
        postId: post.id,
        title: firstLine(post.text, 80),
        action: 'error',
        error: error?.message || String(error),
      }
    }
    if (entry) {
      pushHistory(state, entry)
      result.items.push(entry)
      runtime.log(
        `[foxy-weibo] 博文 ${entry.postId} 《${entry.title}》 -> ${ACTION_LABELS[entry.action] || entry.action}` +
          (entry.error ? `（${firstLine(entry.error, 100)}）` : ''),
      )
    }
    if (result.commented >= maxComments) break
    await new Promise((resolve) => setTimeout(resolve, 600))
  }
  if (!checkOnly && !readOnly && canComment) {
    const nested = await scanNestedReplies(config, state, runtime, posts, loginUid, memoryContext, {
      cid: targetCid,
    })
    result.replied = nested.replied
    result.items.push(...nested.items)
    result.checked += nested.checked
    result.skipped += nested.skipped
    result.errors += nested.errors
    result.pendingReplies = nested.items.filter((item) => item.action === 'pending-reply').length
  }
  state.lastRun = Date.now()
  state.lastResult = result
  return result
}

function parseDateOnly(text) {
  const value = String(text || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T00:00:00+08:00`)
  return Number.isNaN(date.getTime()) ? null : date
}

function dateKey(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function rangeForExtract(config) {
  const now = new Date()
  const customStart = parseDateOnly(config.extractStart)
  const customEnd = parseDateOnly(config.extractEnd)
  if (customStart || customEnd) {
    const start = customStart || new Date(now.getTime() - 30 * 86400000)
    const end = customEnd || now
    return { start, end, startText: dateKey(start), endText: dateKey(end) }
  }
  const unit = ['day', 'week', 'month', 'year'].includes(config.extractUnit) ? config.extractUnit : 'month'
  const count = Math.max(1, Math.min(365, Number(config.extractCount) || 1))
  const start = new Date(now)
  if (unit === 'day') start.setDate(start.getDate() - count)
  else if (unit === 'week') start.setDate(start.getDate() - count * 7)
  else if (unit === 'year') start.setFullYear(start.getFullYear() - count)
  else start.setMonth(start.getMonth() - count)
  return { start, end: now, startText: dateKey(start), endText: dateKey(end) }
}

const EXTRACT_UNITS = new Set(['week', 'month', 'year'])

function postDate(post) {
  const ms = Number(post?.createdAtMs)
  if (Number.isFinite(ms) && ms > 0) return new Date(ms)
  const parsed = post?.createdAt ? new Date(post.createdAt) : null
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null
}

function startOfWeek(date) {
  const start = new Date(date)
  start.setHours(0, 0, 0, 0)
  const day = (start.getDay() + 6) % 7
  start.setDate(start.getDate() - day)
  return start
}

function periodForPost(post, unit) {
  const date = postDate(post)
  if (!date) return null
  if (unit === 'year') {
    const start = new Date(date.getFullYear(), 0, 1)
    const end = new Date(date.getFullYear(), 11, 31)
    return { key: String(date.getFullYear()), start, end, startText: dateKey(start), endText: dateKey(end), posts: [] }
  }
  if (unit === 'month') {
    const start = new Date(date.getFullYear(), date.getMonth(), 1)
    const end = new Date(date.getFullYear(), date.getMonth() + 1, 0)
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    return { key, start, end, startText: dateKey(start), endText: dateKey(end), posts: [] }
  }
  const start = startOfWeek(date)
  const end = new Date(start)
  end.setDate(start.getDate() + 6)
  const week = Math.floor((start - new Date(start.getFullYear(), 0, 1)) / 604800000) + 1
  const key = `${start.getFullYear()}-W${String(week).padStart(2, '0')}`
  return { key, start, end, startText: dateKey(start), endText: dateKey(end), posts: [] }
}

export function groupPostsByUnit(posts, unit) {
  const groups = new Map()
  for (const post of posts) {
    const period = periodForPost(post, unit)
    if (!period) continue
    if (!groups.has(period.key)) groups.set(period.key, period)
    groups.get(period.key).posts.push(post)
  }
  return [...groups.values()]
    .map((group) => {
      group.posts.sort((left, right) => (postDate(left)?.getTime() || 0) - (postDate(right)?.getTime() || 0))
      group.label = `${group.startText} 至 ${group.endText}`
      return group
    })
    .sort((left, right) => left.start - right.start)
}

/**
 * Generate and publish one Weibo status from the configured keywords.
 * Used by both the scheduler and the manual "立即发博" action.
 */
export async function publishPost(config, state, runtime, options = {}) {
  const slot = String(options.slot || '')
  const request = String(options.prompt ?? config.postPrompt ?? '').trim()
  if (!request) return { error: '请先在设置里填写发博关键词/要求' }
  if (!config.cookie) return { error: '请先扫码登录微博账号' }
  let brief = ''
  if (config.postOptimize !== false && typeof runtime.complete === 'function') {
    const cached = String(config.postPromptOptimized || '').trim()
    if (cached && String(config.postPromptOptimizedFor || '') === request) {
      brief = cached
    } else {
      try {
        brief = await optimizePostPrompt(config, request, runtime.complete)
        if (brief) {
          config.postPromptOptimized = brief
          config.postPromptOptimizedFor = request
          if (typeof runtime.saveSettings === 'function') runtime.saveSettings()
        }
      } catch (error) {
        debugLog(state, config, { kind: 'post-optimize', reason: error?.message || String(error) })
      }
    }
  }

  let notes = ''
  if (config.postSearch !== false && typeof runtime.search === 'function') {
    try {
      const results = await runtime.search(request)
      notes = (Array.isArray(results) ? results : [])
        .slice(0, 10)
        .map((item, index) => {
          const title = String(item?.title || '').trim()
          const content = String(item?.content || item?.snippet || '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 500)
          return `${index + 1}. ${title}\n${content}`
        })
        .filter((line) => line.trim())
        .join('\n\n')
        .slice(0, 8000)
    } catch (error) {
      debugLog(state, config, { kind: 'post-search', reason: error?.message || String(error) })
    }
  }
  let text
  try {
    text = await generatePostText(config, request, runtime.complete, notes, brief)
  } catch (error) {
    return { error: error?.message || String(error), stage: 'generate' }
  }
  if (!text) return { error: '模型没有返回微博正文', stage: 'generate' }
  let published
  try {
    published = await postStatus({ text, config })
  } catch (error) {
    return { error: error?.message || String(error), stage: 'publish' }
  }
  const entry = {
    at: Date.now(),
    kind: 'weibo-status',
    postId: published.id,
    title: firstLine(text, 80),
    text,
    url: published.id ? `https://m.weibo.cn/detail/${published.id}` : '',
    action: 'posted',
  }
  pushHistory(state, entry)
  state.lastPost = { at: entry.at, slot, id: published.id, text, url: entry.url, error: '' }
  return { posted: 1, id: published.id, text, url: entry.url }
}

/**
 * Send the configured direct message to every selected mutual follower.
 * A short delay between recipients keeps the request rate low.
 */
export async function sendDirectMessages(config, state, runtime, options = {}) {
  const message = String(options.message ?? config.dmMessage ?? '').trim().slice(0, 300)
  if (!message) return { error: '请先填写私信内容' }
  if (!config.cookie) return { error: '请先扫码登录微博账号' }
  const raw = String(options.targets ?? config.dmTargets ?? '')
  const targets = [...new Set(raw.split(/[\s,，]+/).map((item) => item.trim()).filter(Boolean))]
  if (!targets.length) return { error: '请先选择互关好友' }
  const sleep =
    typeof runtime.sleep === 'function'
      ? runtime.sleep
      : (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const sent = []
  const failed = []
  for (const uid of targets) {
    try {
      await sendDirectMessage({ uid, text: message, config })
      sent.push(uid)
      pushHistory(state, {
        at: Date.now(),
        kind: 'weibo-dm',
        postId: '',
        title: `私信 ${uid}`,
        action: 'sent',
        text: message,
      })
    } catch (error) {
      const reason = error?.message || String(error)
      failed.push({ uid, error: reason })
      pushHistory(state, {
        at: Date.now(),
        kind: 'weibo-dm',
        postId: '',
        title: `私信 ${uid}`,
        action: 'error',
        error: reason,
      })
    }
    await sleep(1200)
  }
  return { sent: sent.length, failed: failed.length, targets: targets.length, errors: failed, message }
}

export async function extractMemories(config, state, runtime, force = false) {
  if (!runtime.memory?.record) return { errors: 1, error: '记忆服务未就绪' }
  const unit = EXTRACT_UNITS.has(config.extractUnit) ? config.extractUnit : 'month'
  const posts = await fetchTimeline(config.targetUid, config, { maxPosts: 3000, maxPages: 150 })
  const dated = posts.filter((post) => postDate(post))
  const groups = groupPostsByUnit(dated, unit)
  state.extractProgress = {
    startedAt: Date.now(),
    unit,
    total: groups.length,
    done: 0,
    current: '',
    posts: dated.length,
    memories: 0,
    errors: 0,
  }
  saveState(state)
  const written = []
  let errors = 0
  for (const group of groups) {
    const key = `${unit}:${group.key}`
    if (!force && state.digests?.[key]?.status === 'done') {
      state.extractProgress.done += 1
      continue
    }
    state.extractProgress.current = group.label
    saveState(state)
    const chunks = []
    for (let i = 0; i < group.posts.length; i += 20) chunks.push(group.posts.slice(i, i + 20))
    const summaries = []
    const events = []
    for (const chunk of chunks) {
      try {
        const result = await summarizeRange(config, chunk, group, runtime.complete)
        if (result.summary) summaries.push(result.summary)
        events.push(...result.events)
      } catch (error) {
        errors += 1
        state.extractProgress.errors = errors
        runtime.log(`[foxy-weibo] ${group.label} 摘要失败：${error?.message || error}`)
      }
      await new Promise((resolve) => setTimeout(resolve, 350))
    }
    const summary = summaries.join('\n').slice(0, 1800)
    const topEvents = events.sort((left, right) => right.importance - left.importance).slice(0, 5)
    const eventText = topEvents
      .map((event) => `- ${event.date || '未知日期'}：${event.title}${event.details ? `。${event.details}` : ''}`)
      .join('\n')
    if (!summary && !eventText) {
      state.digests[key] = { status: 'empty', at: Date.now(), posts: group.posts.length, events: 0 }
      state.extractProgress.done += 1
      saveState(state)
      continue
    }
    const targetLabel = group.posts[0]?.author?.name || '目标账号'
    const text =
      `我在微博回顾了 ${group.startText} 至 ${group.endText} 的博文：${summary || '（本阶段没有可提炼的总结）'}` +
      (eventText ? `\n重要事件：\n${eventText}` : '')
    try {
      await runtime.memory.record({
        role: 'assistant',
        text,
        sessionId: `weibo-digest:${key}`,
        platform: 'weibo',
        speakerKey: config.targetUid ? `weibo:${config.targetUid}` : undefined,
        speakerLabel: targetLabel,
        sourceLabel: '微博阶段回顾',
        eventType: 'weibo_digest',
        channelType: 'weibo_digest',
        channelId: `weibo-digest:${key}`,
        title: group.label,
        scene: 'weibo',
      })
      state.digests[key] = {
        status: 'done',
        at: Date.now(),
        posts: group.posts.length,
        events: topEvents.length,
        summary: summary.slice(0, 300),
        start: group.startText,
        end: group.endText,
      }
      state.extractProgress.memories += 1
      written.push({ key, label: group.label, posts: group.posts.length })
    } catch (error) {
      errors += 1
      state.extractProgress.errors = errors
      runtime.log(`[foxy-weibo] ${group.label} 记忆写入失败：${error?.message || error}`)
    }
    state.extractProgress.done += 1
    saveState(state)
  }
  const result = {
    unit,
    posts: dated.length,
    groups: groups.length,
    memories: written.length,
    events: written.reduce((total, item) => total + (state.digests[item.key]?.events || 0), 0),
    errors,
    items: written,
  }
  state.lastExtract = { at: Date.now(), ...result }
  state.history.unshift({
    at: Date.now(),
    kind: 'weibo-digest-archive',
    action: 'extract',
    unit,
    posts: dated.length,
    groups: groups.length,
    memories: written.length,
  })
  state.history = state.history.slice(0, 50)
  state.extractProgress = null
  debugLog(state, config, { kind: 'extract-archive', ...result })
  saveState(state)
  return result
}

export function createService({
  config,
  state,
  runtime,
  getNextRunAt = () => 0,
  getNextPostAt = () => 0,
  getNextDmAt = () => 0,
}) {
  let running = false

  const beginRun = () => {
    if (running) return false
    if (!acquireStateLock()) return false
    running = true
    Object.assign(state, loadState())
    return true
  }

  const endRun = () => {
    try {
      saveState(state)
    } finally {
      running = false
      releaseStateLock()
    }
  }

  const run = async (reason = 'timer', force = false) => {
    if (!beginRun()) return { skipped: 'busy' }
    try {
      runtime.log(`[foxy-weibo] 开始运行（${reason}）`)
      const result = await scanTargetPosts(config, state, runtime, force)
      runtime.log(`[foxy-weibo] 运行结束 ${JSON.stringify(result)}`)
      return result
    } catch (error) {
      runtime.log(`[foxy-weibo] scan failed: ${error?.message || error}`)
      return { error: String(error?.message || error) }
    } finally {
      endRun()
    }
  }

  const checkNow = async (options = {}) => {
    if (!beginRun()) return { skipped: 'busy' }
    try {
      runtime.log('[foxy-weibo] 开始立即检查')
      const result = await scanTargetPosts(config, state, runtime, true, {
        checkOnly: true,
        maxPosts: options.maxPosts,
        postId: options.postId,
        mode: 'target-posts-check',
      })
      runtime.log(`[foxy-weibo] 立即检查结束 ${JSON.stringify(result)}`)
      return result
    } catch (error) {
      runtime.log(`[foxy-weibo] check failed: ${error?.message || error}`)
      return { error: String(error?.message || error) }
    } finally {
      endRun()
    }
  }

  const readNow = async (options = {}) => {
    if (!beginRun()) return { skipped: 'busy' }
    try {
      runtime.log('[foxy-weibo] 开始立即读取')
      const result = await scanTargetPosts(config, state, runtime, true, {
        readOnly: true,
        maxPosts: Math.max(1, Math.min(100, Number(options.maxPosts ?? config.maxPostsPerRun) || 5)),
        postId: options.postId,
        mode: 'target-posts-read',
      })
      runtime.log(`[foxy-weibo] 立即读取结束 ${JSON.stringify(result)}`)
      return result
    } catch (error) {
      runtime.log(`[foxy-weibo] read failed: ${error?.message || error}`)
      return { error: String(error?.message || error) }
    } finally {
      endRun()
    }
  }

  const replyNow = async (cid = '', postId = '', options = {}) => {
    if (!beginRun()) return { skipped: 'busy' }
    try {
      runtime.log(`[foxy-weibo] 开始立即回复${cid ? ` cid=${cid}` : ''}`)
      const result = await scanTargetPosts(config, state, runtime, true, {
        forceReply: true,
        maxPosts: Math.max(1, Math.min(100, Number(options.maxPosts ?? config.maxPostsPerRun) || 5)),
        maxComments: 1,
        cid,
        postId,
        mode: 'target-posts-reply-now',
      })
      runtime.log(`[foxy-weibo] 立即回复结束 ${JSON.stringify(result)}`)
      return result
    } catch (error) {
      runtime.log(`[foxy-weibo] reply-now failed: ${error?.message || error}`)
      return { error: String(error?.message || error) }
    } finally {
      endRun()
    }
  }

  const postNow = async (options = {}) => {
    if (!beginRun()) return { skipped: 'busy' }
    const slot = String(options.slot || '')
    let attempts = 1
    try {
      const previous = state.lastPost
      const sameSlot = Boolean(slot && previous?.slot === slot)
      if (sameSlot) {
        // A finished slot must never post twice. A generation/search failure
        // may be retried a couple of times; a publish failure may already
        // have created the status, so it is not retried.
        if (!previous.error && previous.status !== 'posting') {
          runtime.log(`[foxy-weibo] 跳过重复发博 slot=${slot}`)
          return { skipped: 'already-posted', slot }
        }
        if (previous.stage === 'publish' || Number(previous.attempts || 0) >= 3) {
          return { skipped: 'failed-earlier', slot, error: previous.error }
        }
      }
      attempts = sameSlot ? Number(previous.attempts || 0) + 1 : 1
      if (slot) {
        state.lastPost = { at: Date.now(), slot, status: 'posting', attempts }
        saveState(state)
      }
      runtime.log(`[foxy-weibo] 开始发微博${slot ? ` slot=${slot} attempt=${attempts}` : ''}`)
      const result = await publishPost(config, state, runtime, options)
      if (result.error) {
        state.lastPost = {
          at: Date.now(),
          slot,
          error: result.error,
          stage: result.stage || 'publish',
          attempts,
        }
      }
      runtime.log(
        `[foxy-weibo] 发微博结束 ${JSON.stringify({
          posted: result.posted || 0,
          id: result.id || '',
          error: result.error || '',
          stage: result.stage || '',
          attempt: attempts,
        })}`,
      )
      return { ...result, attempts }
    } catch (error) {
      const message = String(error?.message || error)
      state.lastPost = { at: Date.now(), slot, error: message, stage: 'generate', attempts }
      runtime.log(`[foxy-weibo] post failed: ${message}`)
      return { error: message, stage: 'generate', attempts }
    } finally {
      endRun()
    }
  }

  const dmNow = async (options = {}) => {
    if (!beginRun()) return { skipped: 'busy' }
    const slot = String(options.slot || '')
    try {
      if (slot && state.lastDm?.slot === slot) {
        runtime.log(`[foxy-weibo] 跳过重复私信 slot=${slot}`)
        return { skipped: 'already-sent', slot }
      }
      if (slot) {
        state.lastDm = { at: Date.now(), slot, status: 'sending' }
        saveState(state)
      }
      runtime.log(`[foxy-weibo] 开始发私信${slot ? ` slot=${slot}` : ''}`)
      const result = await sendDirectMessages(config, state, runtime, options)
      if (result.error) {
        state.lastDm = { at: Date.now(), slot, error: result.error }
      } else {
        state.lastDm = { at: Date.now(), slot, ...result }
      }
      runtime.log(
        `[foxy-weibo] 私信结束 ${JSON.stringify({
          sent: result.sent || 0,
          failed: result.failed || 0,
          error: result.error || '',
        })}`,
      )
      return result
    } catch (error) {
      const message = String(error?.message || error)
      state.lastDm = { at: Date.now(), slot, error: message }
      runtime.log(`[foxy-weibo] dm failed: ${message}`)
      return { error: message }
    } finally {
      endRun()
    }
  }

  const startExtract = () => {
    if (state.extracting) return { started: false, skipped: 'busy' }
    state.extracting = true
    state.extractProgress = {
      startedAt: Date.now(),
      unit: config.extractUnit,
      total: 0,
      done: 0,
      current: '准备中',
      posts: 0,
      memories: 0,
      errors: 0,
    }
    saveState(state)
    extractMemories(config, state, runtime, true)
      .catch((error) => {
        state.lastExtract = {
          at: Date.now(),
          error: String(error?.message || error),
          unit: config.extractUnit,
        }
        runtime.log(`[foxy-weibo] 快速提取失败：${error?.message || error}`)
      })
      .finally(() => {
        state.extracting = false
        saveState(state)
      })
    return { started: true, unit: config.extractUnit }
  }

  const status = () => ({
    enabled: config.enabled === true,
    running,
    mode: 'target-posts',
    targetUid: config.targetUid || '',
    loginUid: config.accountUid || '',
    scheduleTimes: config.scheduleTimes,
    nextRunAt: getNextRunAt(),
    replyMode: config.replyMode,
    postEnabled: config.postEnabled === true,
    postTimes: config.postTimes || [],
    nextPostAt: getNextPostAt(),
    lastPost: state.lastPost || null,
    dmEnabled: config.dmEnabled === true,
    dmTimes: config.dmTimes || [],
    nextDmAt: getNextDmAt(),
    lastDm: state.lastDm || null,
    lastRun: state.lastRun,
    lastResult: state.lastResult,
    recent: state.history.slice(0, 12),
    debugEnabled: config.debug === true,
    debug: state.debug.slice(0, 40),
    seen: Object.keys(state.seen).length,
    commentsToday: commentCount(state),
    cookieSet: Boolean(config.cookie),
    accountName: config.accountName || '',
    accountUid: config.accountUid || '',
    apiKeySet: Boolean(config.llmApiKey),
    llmMode: config.llmMode,
    postsSeen: Object.keys(state.postSeen || {}).length,
    extracting: state.extracting === true,
    extractProgress: state.extractProgress,
    lastExtract: state.lastExtract,
    digests: Object.keys(state.digests || {}).length,
  })

  return {
    config,
    state,
    run,
    checkNow,
    readNow,
    replyNow,
    postNow,
    dmNow,
    startExtract,
    status,
    isRunning: () => running,
  }
}
