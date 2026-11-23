const assert = require('node:assert/strict')
const { mkdtempSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

/**
 * Exercise the scheduled-posting path with a fake Weibo publish endpoint and a
 * fake model, so we catch wiring mistakes without publishing anything.
 */
async function main() {
  process.env.OPENCODE_WEIBO_HOME = mkdtempSync(join(tmpdir(), 'foxy-weibo-post-'))
  const { publishPost, createService, sendDirectMessages } = await import('../lib/core.js')
  const { cleanGeneratedPost, generatePostText, judgePost, optimizePostPrompt } = await import('../lib/judge.js')
  const { loadState } = await import('../lib/state.js')

  assert.equal(cleanGeneratedPost('```text\n正文\n```'), '正文')
  assert.equal(cleanGeneratedPost('微博正文：今天天气不错'), '今天天气不错')
  assert.equal(cleanGeneratedPost('字'.repeat(500)).length, 400)

  const brief = await optimizePostPrompt({ persona: '' }, '整理24小时以内全球新闻TOP10', async ({ system, user }) => {
    assert.match(system, /写作策划/)
    assert.match(user, /整理24小时以内全球新闻TOP10/)
    return '主题：全球新闻\n结构：标题 + 10 条编号，最后加 #每日新闻#'
  })
  assert.match(brief, /结构/)

  const generated = await generatePostText(
    { persona: '' },
    '整理24小时以内全球新闻TOP10',
    async ({ system, user }) => {
      assert.match(system, /写作方案/)
      assert.match(system, /写作指令/)
      assert.match(user, /写作方案（必须遵守）：[\s\S]*标题 \+ 10 条编号/)
      assert.match(user, /整理24小时以内全球新闻TOP10/)
      return '【早报 · 11月23日】\n1. 新闻 A（待核实）\n2. 新闻 B｜据公开资料显示\n#每日新闻#'
    },
    '',
    brief,
  )
  assert.equal(generated, '【早报 · 11月23日】\n1. 新闻 A\n2. 新闻 B\n#每日新闻#')

  const requests = []
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url)
    requests.push({ target, body: String(options.body || '') })
    if (target.includes('weibo.com/ajax/statuses/update')) {
      return new Response(JSON.stringify({ ok: 1, msg: '发布成功', data: { id: 'w1' } }), { status: 200 })
    }
    if (target.includes('weibo.com/aj/message/add')) {
      return new Response(JSON.stringify({ code: '100000', data: { id: 'dm1' } }), { status: 200 })
    }
    throw new Error(`unexpected fetch ${target}`)
  }

  const state = { history: [], lastPost: null }
  const config = {
    cookie: 'SUB=x; XSRF-TOKEN=t',
    postPrompt: '整理24小时以内全球新闻TOP10',
    postOptimize: false,
    persona: '',
  }
  const runtime = {
    complete: async ({ user }) => {
      assert.match(user, /参考资料/)
      assert.match(user, /搜索到的新闻标题/)
      return '1. 新闻 A\n2. 新闻 B'
    },
    search: async (query) => {
      assert.match(query, /整理24小时以内全球新闻TOP10/)
      return [{ title: '搜索到的新闻标题', content: '搜索到的新闻内容' }]
    },
    log: () => {},
  }

  const result = await publishPost(config, state, runtime)
  assert.equal(result.posted, 1)
  assert.equal(result.id, 'w1')
  assert.equal(result.text, '1. 新闻 A\n2. 新闻 B')
  assert.equal(state.lastPost.id, 'w1')
  assert.equal(state.lastPost.error, '')
  assert.equal(state.history.length, 1)
  assert.equal(state.history[0].kind, 'weibo-status')
  assert.equal(state.history[0].action, 'posted')
  assert.equal(requests.length, 1)
  assert.match(requests[0].body, /content=/)

  const serviceState = loadState()
  const service = createService({ config, state: serviceState, runtime })
  const first = await service.postNow({ slot: '2026-11-21 08:00' })
  assert.equal(first.posted, 1, 'first scheduled post publishes')
  const duplicate = await service.postNow({ slot: '2026-11-21 08:00' })
  assert.equal(duplicate.skipped, 'already-posted', 'same slot is not posted twice')
  const next = await service.postNow({ slot: '2026-11-22 08:00' })
  assert.equal(next.posted, 1, 'the next day still posts')

  // A changed requirement is optimized once, then cached for later posts.
  let optimizerCalls = 0
  let saved = 0
  const cachedConfig = {
    ...config,
    postPrompt: '写一条今天的科技新闻早报',
    postOptimize: true,
    postPromptOptimized: '',
    postPromptOptimizedFor: '',
  }
  const cachedState = loadState()
  const cachedRuntime = {
    complete: async ({ system, user }) => {
      if (system.includes('写作策划')) {
        optimizerCalls += 1
        return '主题：科技新闻\n结构：标题 + 编号条目'
      }
      assert.match(user, /写作方案（必须遵守）：[\s\S]*科技新闻/)
      return '【科技早报】\n1. 新闻 A'
    },
    search: async () => [],
    log: () => {},
    saveSettings: () => {
      saved += 1
    },
  }
  const cachedService = createService({ config: cachedConfig, state: cachedState, runtime: cachedRuntime })
  await cachedService.postNow({ slot: '2026-11-24 08:30' })
  assert.equal(optimizerCalls, 1, 'prompt is optimized once')
  assert.equal(saved, 1, 'optimized prompt is persisted')
  await cachedService.postNow({ slot: '2026-11-25 08:30' })
  assert.equal(optimizerCalls, 1, 'cached prompt is reused')
  assert.equal(cachedConfig.postPromptOptimizedFor, '写一条今天的科技新闻早报')

  const missingPrompt = await publishPost({ ...config, postPrompt: '' }, state, runtime)
  assert.match(missingPrompt.error, /关键词/)
  const noCookie = await publishPost({ ...config, cookie: '' }, state, runtime)
  assert.match(noCookie.error, /登录/)

  let seenCommentPrompt = ''
  const judged = await judgePost(
    { persona: '' },
    {
      summary: '博主：主人\n正文：今天去看海了',
      comments: [],
      commentsText: '',
      targetPost: { id: 'p1', text: '今天去看海了', author: { name: '主人' }, url: '' },
      memoryContext: '',
      mayComment: true,
      mayReply: false,
      forceComment: true,
    },
    async ({ user }) => {
      seenCommentPrompt = user
      return JSON.stringify({
        action: 'comment',
        comment: '海风这么大，你的发型还好吗？'.repeat(10),
        memory: '',
        replyTo: 0,
      })
    },
  )
  assert.match(seenCommentPrompt, /幽默风趣/)
  assert.match(seenCommentPrompt, /最多 60 字/)
  assert.equal(judged.comment.length, 60, 'comments are capped at 60 characters')

  const dmConfig = {
    cookie: 'SUB=x; XSRF-TOKEN=t',
    dmMessage: '降温了，记得添衣',
    dmTargets: '111, 222',
  }
  const dmState = { history: [], lastDm: null }
  const dmRuntime = { sleep: async () => {}, log: () => {} }
  const dmResult = await sendDirectMessages(dmConfig, dmState, dmRuntime)
  assert.equal(dmResult.sent, 2)
  assert.equal(dmResult.failed, 0)
  assert.equal(dmResult.targets, 2)
  assert.equal(dmState.history.filter((item) => item.kind === 'weibo-dm' && item.action === 'sent').length, 2)

  const dmServiceState = loadState()
  const dmService = createService({ config: dmConfig, state: dmServiceState, runtime: dmRuntime })
  const firstDm = await dmService.dmNow({ slot: '2026-11-24 09:00' })
  assert.equal(firstDm.sent, 2, 'scheduled dm is sent to every target')
  const duplicateDm = await dmService.dmNow({ slot: '2026-11-24 09:00' })
  assert.equal(duplicateDm.skipped, 'already-sent', 'same dm slot is not sent twice')

  console.log('foxy-weibo post tests passed')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
