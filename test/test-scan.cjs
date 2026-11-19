const assert = require('node:assert/strict')
const { mkdtempSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

/**
 * Exercise the full scan path with a fake Weibo API and a fake model.
 * This catches wiring mistakes that unit tests of single helpers miss.
 */
async function main() {
  process.env.OPENCODE_WEIBO_HOME = mkdtempSync(join(tmpdir(), 'foxy-weibo-scan-'))
  const { scanTargetPosts } = await import('../lib/core.js')

  const requests = []
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url)
    requests.push(target)
    if (target.includes('m.weibo.cn/api/config')) {
      return new Response(JSON.stringify({ data: { uid: '7', screen_name: 'AiFoxy' } }), { status: 200 })
    }
    if (target.includes('m.weibo.cn/api/container/getIndex')) {
      return new Response(
        JSON.stringify({
          data: {
            cards: [
              {
                mblog: {
                  id: 'p1',
                  mid: 'p1',
                  text: '今天去看海了',
                  created_at: new Date().toISOString(),
                  comments_count: 0,
                  user: { id: '123', screen_name: '主人' },
                },
              },
            ],
          },
        }),
        { status: 200 },
      )
    }
    if (target.includes('comments/create')) {
      return new Response(JSON.stringify({ ok: 1, data: { id: 'c1' } }), { status: 200 })
    }
    throw new Error(`unexpected fetch ${target}`)
  }

  const complete = async ({ user }) => {
    if (user.includes('整理自己的长期记忆')) return '{"memory":"我在微博看到主人今天去看海了。"}'
    return '{"action":"comment","comment":"海边风大，记得带外套。","memory":"","replyTo":0}'
  }

  const memories = []
  const config = {
    enabled: true,
    cookie: 'SUB=x; XSRF-TOKEN=t',
    targetUid: '1234567',
    accountUid: '7',
    replyMode: 'auto',
    replyNested: false,
    learnPosts: true,
    enableMemory: true,
    scheduleTimes: ['20:00'],
    maxPostsPerRun: 1,
    maxCommentsPerDay: 1,
    replyAfter: '',
    debug: false,
    persona: '',
    customPrompt: '',
  }
  const state = { postSeen: {}, commentSeen: {}, postMemory: {}, days: {}, history: [], debug: [] }
  const runtime = {
    complete,
    memory: {
      record: async (event) => {
        memories.push(event)
        return { ok: true }
      },
      context: async () => '',
    },
    log: () => {},
  }

  const result = await scanTargetPosts(config, state, runtime, true, { mode: 'test' })
  assert.equal(result.posts, 1)
  assert.equal(result.commented, 1)
  assert.equal(result.memories, 1)
  assert.equal(result.errors, 0)
  assert.equal(state.postSeen.p1.status, 'commented')
  assert.equal(state.postSeen.p1.commentId, 'c1')
  assert.equal(state.days[Object.keys(state.days)[0]].comments, 1)
  assert.equal(memories.length, 1)
  assert.equal(memories[0].eventType, 'weibo_owner_post')
  assert.ok(requests.some((url) => url.includes('comments/create')))

  // The second run must not comment on the same post again.
  const before = memories.length
  const requestCount = requests.length
  const second = await scanTargetPosts(config, state, runtime, true, { mode: 'test' })
  assert.equal(second.commented, 0)
  assert.equal(memories.length, before)
  assert.ok(!requests.slice(requestCount).some((url) => url.includes('comments/create')))

  // Preview mode must never publish.
  const previewState = { postSeen: {}, commentSeen: {}, postMemory: {}, days: {}, history: [], debug: [] }
  const preview = await scanTargetPosts(config, previewState, runtime, true, { previewOnly: true })
  assert.equal(preview.previewed, 1)
  assert.equal(preview.commented, 0)
  assert.ok(!previewState.postSeen.p1)

  // Checking must not write memory or touch postSeen.
  const checkState = { postSeen: {}, commentSeen: {}, postMemory: {}, days: {}, history: [], debug: [] }
  const checked = await scanTargetPosts(config, checkState, runtime, true, { checkOnly: true })
  assert.equal(checked.items.length, 1)
  assert.equal(checked.items[0].postId, 'p1')
  assert.equal(checked.memories, 0)
  assert.ok(!checkState.postSeen.p1)

  console.log('foxy-weibo scan tests passed')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
