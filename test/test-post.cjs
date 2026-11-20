const assert = require('node:assert/strict')

/**
 * Exercise the scheduled-posting path with a fake Weibo publish endpoint and a
 * fake model, so we catch wiring mistakes without publishing anything.
 */
async function main() {
  const { publishPost } = await import('../lib/core.js')
  const { cleanGeneratedPost, generatePostText } = await import('../lib/judge.js')

  assert.equal(cleanGeneratedPost('```text\n正文\n```'), '正文')
  assert.equal(cleanGeneratedPost('微博正文：今天天气不错'), '今天天气不错')
  assert.equal(cleanGeneratedPost('字'.repeat(500)).length, 400)

  const generated = await generatePostText(
    { persona: '' },
    '整理24小时以内全球新闻TOP10',
    async ({ user }) => {
      assert.match(user, /整理24小时以内全球新闻TOP10/)
      return '1. 新闻 A\n2. 新闻 B'
    },
  )
  assert.equal(generated, '1. 新闻 A\n2. 新闻 B')

  const requests = []
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url)
    requests.push({ target, body: String(options.body || '') })
    if (target.includes('weibo.com/ajax/statuses/update')) {
      return new Response(JSON.stringify({ ok: 1, msg: '发布成功', data: { id: 'w1' } }), { status: 200 })
    }
    throw new Error(`unexpected fetch ${target}`)
  }

  const state = { history: [], lastPost: null }
  const config = {
    cookie: 'SUB=x; XSRF-TOKEN=t',
    postPrompt: '整理24小时以内全球新闻TOP10',
    persona: '',
  }
  const runtime = {
    complete: async () => '1. 新闻 A\n2. 新闻 B',
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

  const missingPrompt = await publishPost({ ...config, postPrompt: '' }, state, runtime)
  assert.match(missingPrompt.error, /关键词/)
  const noCookie = await publishPost({ ...config, cookie: '' }, state, runtime)
  assert.match(noCookie.error, /登录/)

  console.log('foxy-weibo post tests passed')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
