const assert = require('node:assert/strict')
const { mkdtempSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

async function main() {
  const home = mkdtempSync(join(tmpdir(), 'foxy-weibo-'))
  process.env.OPENCODE_WEIBO_HOME = home

  const settings = await import('../lib/settings.js')
  const memory = await import('../lib/memory.js')
  const state = await import('../lib/state.js')
  const core = await import('../lib/core.js')

  assert.equal(settings.foxyHome(), home)
  assert.equal(settings.settingsPath(), join(home, 'settings.json'))
  assert.equal(settings.normalizePatch({}, {}).llmMode, 'opencode')
  assert.equal(settings.normalizePatch({}, { llmMode: 'direct' }).llmMode, 'direct')
  assert.equal(settings.normalizePatch({}, { persona: '  自定义人设  ' }).persona, '自定义人设')
  assert.equal(settings.normalizePatch({}, { llmMode: 'weird' }).llmMode, 'opencode')
  assert.equal(settings.normalizePatch({}, { extractUnit: 'week' }).extractUnit, 'week')
  assert.equal(settings.normalizePatch({}, { extractUnit: 'year' }).extractUnit, 'year')
  assert.equal(settings.normalizePatch({}, { extractUnit: 'nope' }).extractUnit, 'month')
  assert.equal(settings.normalizePatch({}, {}).postEnabled, false)
  assert.equal(settings.normalizePatch({}, { postEnabled: true }).postEnabled, true)
  assert.deepEqual(settings.normalizePatch({}, { postTimes: '08:00, 21:30' }).postTimes, ['08:00', '21:30'])
  assert.deepEqual(settings.normalizePatch({}, { postTimes: '25:00' }).postTimes, [])
  assert.equal(
    settings.normalizePatch({}, { postPrompt: '  整理新闻  ' }).postPrompt,
    '整理新闻',
  )
  assert.equal(settings.normalizePatch({}, {}).dmEnabled, false)
  assert.equal(settings.normalizePatch({}, { dmEnabled: true }).dmEnabled, true)
  assert.deepEqual(settings.normalizePatch({}, { dmTimes: '09:00, 21:00' }).dmTimes, ['09:00', '21:00'])
  assert.equal(settings.normalizePatch({}, { dmMessage: '  降温了  ' }).dmMessage, '降温了')
  assert.equal(settings.normalizePatch({}, { dmTargets: ' 111, 222 ' }).dmTargets, '111, 222')

  const saved = settings.saveSettings({
    ...settings.DEFAULTS,
    cookie: 'SUB=secret',
    llmApiKey: 'sk-secret',
    targetUid: '123456',
    enabled: true,
  })
  assert.equal(saved, join(home, 'settings.json'))
  const loaded = settings.loadSettings()
  assert.equal(loaded.cookie, 'SUB=secret')
  assert.equal(loaded.llmApiKey, 'sk-secret')
  assert.equal(loaded.targetUid, '123456')
  assert.equal(loaded.enabled, true)
  const view = settings.publicSettings(loaded)
  assert.equal(view.cookie, undefined)
  assert.equal(view.llmApiKey, undefined)
  assert.equal(view.cookieSet, true)
  assert.equal(view.llmApiKeySet, true)

  const store = memory.createMemoryStore({})
  await store.record({ text: '我在微博看到一条关于猫的博文', eventType: 'weibo_owner_post' })
  await store.record({ text: '我在微博评论了一条关于狗的博文', eventType: 'weibo_comment' })
  const context = await store.context({ limit: 2 })
  assert.match(context, /猫/)
  assert.match(context, /狗/)
  const found = await store.search('猫', 5)
  assert.equal(found.length, 1)
  assert.match(found[0].text, /猫/)

  const initial = state.loadState()
  initial.postSeen.p1 = { status: 'commented', at: Date.now() }
  initial.history.push({ at: Date.now(), action: 'comment' })
  state.saveState(initial)
  const reloaded = state.loadState()
  assert.equal(reloaded.postSeen.p1.status, 'commented')
  assert.equal(reloaded.history.length, 1)
  assert.equal(reloaded.judgeSessionId, '')

  const config = settings.normalizePatch(settings.DEFAULTS, { enabled: true })
  const service = core.createService({
    config,
    state: reloaded,
    runtime: { complete: async () => '', memory: store, log: () => {} },
    getNextRunAt: () => 12345,
  })
  const status = service.status()
  assert.equal(status.enabled, true)
  assert.equal(status.nextRunAt, 12345)
  assert.equal(status.postsSeen, 1)
  assert.equal(status.llmMode, 'opencode')

  console.log('foxy-weibo core tests passed')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
