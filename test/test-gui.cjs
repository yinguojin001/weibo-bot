const assert = require('node:assert/strict')
const Module = require('node:module')
const path = require('node:path')

/**
 * The GUI part is a CommonJS bundle for OpenCode Desktop. This test loads it
 * with the app's shared modules stubbed out and a very small DOM shim, so we
 * can check the settings page renders and calls the RPC contract correctly
 * without starting the desktop app.
 */

class FakeText {
  constructor(text) {
    this.nodeType = 3
    this.textContent = String(text)
    this.parentNode = null
  }

  remove() {
    if (!this.parentNode) return
    const index = this.parentNode.children.indexOf(this)
    if (index >= 0) this.parentNode.children.splice(index, 1)
    this.parentNode = null
  }
}

class FakeNode {
  constructor(tag) {
    this.nodeType = 1
    this.tagName = String(tag).toUpperCase()
    this.children = []
    this.attributes = {}
    this.listeners = {}
    this.style = {}
    this.className = ''
    this.value = ''
    this.checked = false
    this.textContent = ''
    this.parentNode = null
    this.src = ''
    this.href = ''
    this.target = ''
    this.rel = ''
  }

  append(...nodes) {
    for (const node of nodes.flat(Infinity)) {
      const child = typeof node === 'string' ? new FakeText(node) : node
      if (!child) continue
      child.parentNode = this
      this.children.push(child)
    }
  }

  replaceChildren(...nodes) {
    for (const child of this.children) child.parentNode = null
    this.children = []
    this.append(...nodes)
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value)
  }

  removeAttribute(name) {
    delete this.attributes[name]
  }

  addEventListener(name, listener) {
    this.listeners[name] = listener
  }

  remove() {
    if (!this.parentNode) return
    const index = this.parentNode.children.indexOf(this)
    if (index >= 0) this.parentNode.children.splice(index, 1)
    this.parentNode = null
  }

  text() {
    const own = this.textContent ? [this.textContent] : []
    return [...own, ...this.children.map((child) => (child.text ? child.text() : child.textContent))].join(' ')
  }

  find(predicate) {
    if (predicate(this)) return this
    for (const child of this.children) {
      if (child.find) {
        const found = child.find(predicate)
        if (found) return found
      }
    }
    return undefined
  }

  findAll(predicate, out = []) {
    if (predicate(this)) out.push(this)
    for (const child of this.children) {
      if (child.findAll) child.findAll(predicate, out)
    }
    return out
  }
}

globalThis.Node = FakeNode
globalThis.document = {
  createElement: (tag) => new FakeNode(tag),
  createTextNode: (text) => new FakeText(text),
  head: { appendChild() {} },
}
globalThis.window = { confirm: () => true }

const cleanups = []
const stub = (id) => {
  if (id === '@opencode/plugin/gui') {
    return {
      Plugin: { define: (definition) => definition },
      SettingsPage: 'SettingsPage',
    }
  }
  if (id === '@opencode/plugin/rpc') {
    return { Rpc: { define: (definition) => definition } }
  }
  if (id === 'solid-js') {
    return {
      onCleanup: (fn) => {
        cleanups.push(fn)
      },
    }
  }
  return undefined
}

const originalLoad = Module._load
Module._load = function load(request, parent, isMain) {
  const replaced = stub(request)
  if (replaced) return replaced
  return originalLoad.call(this, request, parent, isMain)
}

async function main() {
  const gui = require(path.join(__dirname, '..', 'lib', 'gui.cjs'))
  assert.equal(typeof gui.setup, 'function')

  const calls = []
  const settings = {
    enabled: true,
    targetUid: '1234567',
    scheduleTimes: ['08:30', '20:00'],
    replyMode: 'off',
    replyAfter: '',
    replyNested: true,
    learnPosts: true,
    enableMemory: true,
    runOnStart: false,
    debug: false,
    maxPostsPerRun: 7,
    maxCommentsPerDay: 1,
    persona: '',
    llmMode: 'opencode',
    llmBaseUrl: 'https://api.deepseek.com',
    llmModel: 'deepseek-chat',
    customPrompt: '',
    extractUnit: 'month',
    extractPrompt: '',
    cookieSet: false,
    llmApiKeySet: false,
    accountName: '',
    accountUid: '',
  }
  const status = {
    enabled: true,
    running: false,
    seen: 3,
    commentsToday: 1,
    postsSeen: 2,
    lastRun: Date.now(),
    recent: [],
    debug: [],
    extracting: false,
  }
  const client = {
    rpc(contract) {
      assert.equal(contract.id, 'foxy-weibo')
      return {
        status: async (input) => {
          calls.push(['status', input])
          assert.deepEqual(input, {}, 'status must pass an input object')
          return { ok: true, status, settings }
        },
        models: async (input) => {
          calls.push(['models', input])
          assert.deepEqual(input, {}, 'models must pass an input object')
          return {
            ok: true,
            models: [{ id: 'deepseek/deepseek-flash', name: 'DeepSeek V4.1 Flash', provider: 'deepseek' }],
          }
        },
        update: async (input) => {
          calls.push(['update', input])
          return { ok: true, status, settings }
        },
        loginStart: async (input) => {
          calls.push(['loginStart', input])
          assert.deepEqual(input, {}, 'loginStart must pass an input object')
          return { ok: true, qrid: 'q1', qr: 'data:image/png;base64,AA' }
        },
        loginPoll: async (input) => {
          calls.push(['loginPoll', input])
          assert.deepEqual(input, { qrid: 'q1' })
          return { ok: true, state: 'waiting' }
        },
        logout: async (input) => {
          calls.push(['logout', input])
          assert.deepEqual(input, {}, 'logout must pass an input object')
          return { ok: true, status, settings }
        },
        run: async (input) => {
          calls.push(['run', input])
          return { ok: true, result: { posts: 1, memories: 1 }, status }
        },
      }
    },
  }

  const added = []
  const ctx = {
    id: 'foxy-weibo',
    client,
    add(token, item) {
      added.push({ token, item })
    },
  }

  const cleanup = gui.setup(ctx)
  assert.equal(added.length, 1)
  assert.equal(added[0].token, 'SettingsPage')
  const page = added[0].item
  assert.equal(page.id, 'foxy-weibo')
  assert.equal(page.title, '微博')
  assert.equal(page.entries.length, 4)
  assert.equal(page.entries[0].id, 'account')

  const node = page.render({})
  assert.ok(node instanceof FakeNode)
  assert.match(node.text(), /正在读取微博设置/)

  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.ok(
    calls.some((call) => call[0] === 'status' && JSON.stringify(call[1]) === '{}'),
    'status called with an input object',
  )
  const text = node.text()
  assert.match(text, /微博评论/)
  assert.match(text, /自动浏览已开启/)
  assert.ok(
    node.find((item) => item.tagName === 'INPUT' && item.value === '1234567'),
    'target UID input is filled',
  )
  for (const label of ['保存设置', '扫码登录', '立即检查博文']) {
    const button = node.find((item) => item.tagName === 'BUTTON' && item.text() === label)
    assert.ok(button, `${label} button rendered`)
    assert.equal('disabled' in button.attributes, false, `${label} button must be enabled when idle`)
  }
  for (const select of node.findAll((item) => item.tagName === 'SELECT')) {
    assert.equal(
      select.findAll((item) => item.tagName === 'OPTION' && 'selected' in item.attributes).length,
      1,
      'each select has exactly one selected option',
    )
  }

  const saveButton = node.findAll((item) => item.tagName === 'BUTTON' && item.text() === '保存设置')[0]
  assert.ok(saveButton, 'save button rendered')
  await saveButton.listeners.click()
  const update = calls.find((call) => call[0] === 'update')
  assert.ok(update, 'update called')
  assert.equal(update[1].patch.targetUid, '1234567')
  assert.equal(update[1].patch.scheduleTimes, '08:30, 20:00')
  const modelSelect = node
    .findAll((item) => item.tagName === 'SELECT')
    .find((select) =>
      select
        .findAll((item) => item.tagName === 'OPTION')
        .some((option) => option.value === 'deepseek/deepseek-flash'),
    )
  assert.ok(modelSelect, 'model select lists OpenCode models')

  // Editing a control schedules a quiet save, so a refresh keeps the change.
  const unitSelect = node
    .findAll((item) => item.tagName === 'SELECT')
    .find((select) =>
      select.findAll((item) => item.tagName === 'OPTION').some((option) => option.value === 'year'),
    )
  assert.ok(unitSelect, 'extract unit select rendered')
  unitSelect.value = 'year'
  unitSelect.listeners.change?.({ target: unitSelect })
  node.listeners.change?.({ target: unitSelect })
  modelSelect.value = 'deepseek/deepseek-flash'
  modelSelect.listeners.change?.({ target: modelSelect })
  node.listeners.change?.({ target: modelSelect })
  await new Promise((resolve) => setTimeout(resolve, 700))
  const autoSave = calls.filter((call) => call[0] === 'update').at(-1)
  assert.equal(autoSave[1].patch.extractUnit, 'year', 'changes are saved without pressing the button')
  assert.equal(autoSave[1].patch.model, 'deepseek/deepseek-flash', 'selected model is saved')

  const loginButton = node.findAll((item) => item.tagName === 'BUTTON' && item.text() === '扫码登录')[0]
  assert.ok(loginButton, 'login button rendered')
  loginButton.listeners.click()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(calls.find((call) => call[0] === 'loginStart'), ['loginStart', {}])
  assert.deepEqual(calls.find((call) => call[0] === 'loginPoll'), ['loginPoll', { qrid: 'q1' }])

  const checkButton = node.findAll((item) => item.tagName === 'BUTTON' && item.text() === '立即检查博文')[0]
  assert.ok(checkButton, 'check button rendered')
  await checkButton.listeners.click()
  assert.deepEqual(calls.find((call) => call[0] === 'run')[1], { mode: 'check' })

  assert.equal(typeof cleanup, 'function')
  cleanup()
  for (const dispose of cleanups) dispose()

  console.log('foxy-weibo gui tests passed')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
