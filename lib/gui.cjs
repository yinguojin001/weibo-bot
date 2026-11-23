/*
 * OpenCode Desktop settings page for foxy-weibo.
 *
 * This file is the plugin's `./gui-experimental` part. It is loaded as a
 * prebuilt CommonJS bundle and may only require modules the app provides:
 * `@opencode/plugin/gui`, `@opencode/plugin/rpc` and `solid-js`.
 */
const { Plugin, SettingsPage } = require('@opencode/plugin/gui')
const { Rpc } = require('@opencode/plugin/rpc')
const { onCleanup } = require('solid-js')

const AnyObject = { type: 'object', additionalProperties: true }
const Empty = { type: 'object', properties: {}, additionalProperties: false }

// Keep this contract in sync with lib/rpc.js.
const Weibo = Rpc.define({
  id: 'foxy-weibo',
  methods: {
    status: {
      input: Empty,
      output: AnyObject,
    },
    models: {
      input: Empty,
      output: AnyObject,
    },
    friends: {
      input: Empty,
      output: AnyObject,
    },
    update: {
      input: {
        type: 'object',
        properties: { patch: AnyObject },
        required: ['patch'],
        additionalProperties: false,
      },
      output: AnyObject,
    },
    loginStart: { input: Empty, output: AnyObject },
    loginPoll: {
      input: {
        type: 'object',
        properties: { qrid: { type: 'string' } },
        required: ['qrid'],
        additionalProperties: false,
      },
      output: AnyObject,
    },
    logout: { input: Empty, output: AnyObject },
    run: {
      input: {
        type: 'object',
        properties: {
          mode: { type: 'string' },
          cid: { type: 'string' },
          postId: { type: 'string' },
        },
        additionalProperties: false,
      },
      output: AnyObject,
    },
  },
  events: {},
})

const CSS = `
.fw-page { padding: 28px 32px 44px; max-width: 880px; color: inherit; height: 100%; overflow: auto; box-sizing: border-box; }
.fw-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 18px; }
.fw-eyebrow { margin: 0 0 6px; opacity: .6; font-size: 11px; letter-spacing: .12em; text-transform: uppercase; }
.fw-head h1 { margin: 0; font-size: 22px; line-height: 1.25; }
.fw-head p { margin: 6px 0 0; opacity: .65; font-size: 12px; }
.fw-badge { flex: none; border: 1px solid rgba(127,127,127,.3); border-radius: 999px; padding: 4px 10px; opacity: .7; font-size: 11px; }
.fw-card { margin-bottom: 14px; padding: 18px 20px; border: 1px solid rgba(127,127,127,.25); border-radius: 12px; }
.fw-card h2 { margin: 0; font-size: 15px; }
.fw-card > p { margin: 5px 0 14px; opacity: .65; font-size: 12px; line-height: 1.6; }
.fw-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px 18px; }
.fw-field { min-width: 0; }
.fw-field label { display: block; font-size: 12px; font-weight: 600; }
.fw-field small { display: block; margin-top: 3px; opacity: .6; font-size: 11px; line-height: 1.45; }
.fw-field input, .fw-field select, .fw-field textarea { width: 100%; box-sizing: border-box; margin-top: 5px; padding: 7px 9px; border: 1px solid rgba(127,127,127,.3); border-radius: 7px; background: transparent; color: inherit; font: inherit; font-size: 12px; }
.fw-field textarea { min-height: 90px; resize: vertical; }
.fw-toggle { display: flex; align-items: flex-start; gap: 10px; margin-top: 12px; cursor: pointer; }
.fw-toggle input { flex: none; margin-top: 3px; }
.fw-toggle strong { display: block; font-size: 12px; }
.fw-toggle small { display: block; margin-top: 2px; opacity: .6; font-size: 11px; }
.fw-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
.fw-qr { display: flex; align-items: center; gap: 14px; margin-top: 12px; padding: 10px; border: 1px solid rgba(127,127,127,.25); border-radius: 8px; }
.fw-qr img { display: block; flex: none; width: 180px; height: 180px; background: #fff; }
.fw-qr p { margin: 0; font-size: 12px; opacity: .75; }
.fw-btn { border: 1px solid rgba(127,127,127,.3); border-radius: 7px; padding: 7px 12px; background: transparent; color: inherit; font: inherit; font-size: 12px; cursor: pointer; }
.fw-btn.primary { background: #2563eb; border-color: #2563eb; color: #fff; }
.fw-btn:disabled { opacity: .55; cursor: default; }
.fw-times { display: flex; flex-direction: column; gap: 8px; margin-top: 5px; }
.fw-time-row { display: flex; align-items: center; gap: 8px; }
.fw-time-row input[type="time"] { width: 150px; margin-top: 0; }
.fw-time-row .fw-btn { padding: 5px 10px; }
.fw-friends { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 6px 12px; max-height: 220px; overflow: auto; margin-top: 6px; padding: 8px; border: 1px solid rgba(127,127,127,.25); border-radius: 8px; }
.fw-friend { display: flex; align-items: center; gap: 6px; font-size: 12px; }
.fw-alert { margin: 10px 0 0; padding: 8px 10px; border-radius: 7px; font-size: 12px; }
.fw-error { color: #b42318; background: rgba(180, 40, 40, .1); }
.fw-ok { color: #217a45; background: rgba(40, 130, 70, .1); }
.fw-muted { margin: 8px 0; opacity: .65; font-size: 12px; }
.fw-stats { display: flex; flex-wrap: wrap; gap: 18px; margin-top: 12px; }
.fw-stats div { min-width: 80px; }
.fw-stats strong { display: block; font-size: 18px; }
.fw-stats small { opacity: .6; font-size: 11px; }
.fw-log { margin-top: 10px; border-top: 1px solid rgba(127,127,127,.25); }
.fw-row { padding: 9px 0; border-bottom: 1px solid rgba(127,127,127,.18); }
.fw-row a { display: block; color: inherit; font-size: 12px; text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fw-row a:hover { text-decoration: underline; }
.fw-row small, .fw-row p { opacity: .65; font-size: 11px; }
.fw-row p { margin: 3px 0 0; }
.fw-debug pre { margin: 5px 0 0; max-height: 140px; overflow: auto; white-space: pre-wrap; word-break: break-word; opacity: .7; font-size: 10px; }
@media (max-width: 720px) { .fw-page { padding: 20px 16px 32px; } .fw-grid { grid-template-columns: 1fr; } }
`

// Boolean attributes are presence-based in HTML: `disabled="false"` still
// disables the element. Set them only when true, otherwise remove them.
const BOOLEAN_ATTRS = new Set([
  'disabled',
  'readonly',
  'required',
  'selected',
  'hidden',
  'multiple',
  'autofocus',
  'novalidate',
])

function el(tag, props, ...children) {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(props || {})) {
    if (value === undefined || value === null) continue
    if (key === 'class') node.className = value
    else if (key === 'style') Object.assign(node.style, value)
    else if (key === 'value') node.value = value
    else if (key === 'checked') node.checked = Boolean(value)
    else if (BOOLEAN_ATTRS.has(key)) {
      if (value) node.setAttribute(key, '')
      else if (typeof node.removeAttribute === 'function') node.removeAttribute(key)
    } else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value)
    } else node.setAttribute(key, value)
  }
  for (const child of children.flat(Infinity)) {
    if (child === undefined || child === null || child === false) continue
    node.append(child instanceof Node ? child : document.createTextNode(String(child)))
  }
  return node
}

function field(label, hint, control) {
  return el(
    'div',
    { class: 'fw-field' },
    el('label', null, label),
    hint ? el('small', null, hint) : null,
    control,
  )
}

function toggle(label, hint, checked, onChange) {
  const input = el('input', { type: 'checkbox', checked, onchange: (event) => onChange(event.target.checked) })
  return el(
    'label',
    { class: 'fw-toggle' },
    input,
    el('span', null, el('strong', null, label), hint ? el('small', null, hint) : null),
  )
}

function card(title, description, ...children) {
  return el(
    'section',
    { class: 'fw-card' },
    el('h2', null, title),
    description ? el('p', null, description) : null,
    ...children,
  )
}

function actionButton(label, busyLabel, busy, onClick) {
  return el('button', { class: 'fw-btn', disabled: Boolean(busy), onclick: onClick }, busy ? busyLabel : label)
}

function formatTime(value) {
  if (!value) return '尚未运行'
  try {
    return new Date(value).toLocaleString()
  } catch {
    return String(value)
  }
}

function makeView(ctx) {
  const root = el('div', { class: 'fw-page' })
  let settings = null
  let status = null
  let busy = ''
  let error = ''
  let notice = ''
  let qr = ''
  let qrState = ''
  let qrTimer = null
  let disposed = false
  let badgeEl = null
  let models = []
  let friends = []
  let friendsLoaded = false
  let friendsLoading = false
  let friendsError = ''
  const draft = { cookie: '', apiKey: '', scheduleTimes: '' }

  const AUTO_SAVE_DELAY = 500
  let saveTimer = null
  let saving = false
  let saveAgain = false

  const api = () => ctx.client.rpc(Weibo)

  function cleanup() {
    disposed = true
    if (qrTimer) clearTimeout(qrTimer)
    qrTimer = null
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = null
  }
  try {
    onCleanup(cleanup)
  } catch {
    // The host may render outside a reactive owner; cleanup is best effort.
  }

  root.addEventListener('input', queueSave)
  root.addEventListener('change', queueSave)

  async function refresh() {
    try {
      const [data, modelData] = await Promise.all([
        api().status({}),
        api().models({}).catch(() => null),
      ])
      if (disposed) return
      if (Array.isArray(modelData?.models)) models = modelData.models
      settings = data.settings
      status = data.status
      draft.scheduleTimes = (settings?.scheduleTimes || []).join(', ')
      draft.postTimes = (settings?.postTimes || []).join(', ')
      draft.dmTimes = (settings?.dmTimes || []).join(', ')
      error = ''
      if (settings?.dmEnabled || settings?.dmTargets) void loadFriends()
      rebuild()
    } catch (err) {
      if (disposed) return
      error = err?.message || String(err)
      rebuild()
    }
  }

  function setError(err) {
    error = err?.message || String(err)
    notice = ''
    rebuild()
  }

  async function run(name, fn, busyLabel) {
    busy = name
    error = ''
    notice = ''
    rebuild()
    try {
      const data = await fn()
      if (disposed) return
      if (data?.status) status = data.status
      if (data?.settings) settings = data.settings
      const result = data?.result || {}
      if (result?.error) {
        busy = ''
        setError(result.error)
        return
      }
      notice = busyLabel(result)
      busy = ''
      rebuild()
    } catch (err) {
      if (disposed) return
      busy = ''
      setError(err)
    }
  }

  function summaryResult(result) {
    const parts = []
    if (result.posts !== undefined) parts.push(`博文 ${result.posts} 篇`)
    if (result.memories !== undefined) parts.push(`记忆 ${result.memories} 条`)
    if (result.commented !== undefined) parts.push(`评论 ${result.commented} 条`)
    if (result.replied !== undefined) parts.push(`回复 ${result.replied} 条`)
    if (result.skipped) parts.push(`跳过 ${result.skipped}`)
    if (result.errors) parts.push(`失败 ${result.errors}`)
    return parts.join('，') || '完成'
  }

  function buildPatch() {
    const patch = {
      targetUid: draft.targetUid,
      scheduleTimes: draft.scheduleTimes,
      postEnabled: draft.postEnabled,
      postTimes: draft.postTimes,
      postPrompt: draft.postPrompt,
      postSearch: draft.postSearch,
      postOptimize: draft.postOptimize,
      dmEnabled: draft.dmEnabled,
      dmTimes: draft.dmTimes,
      dmTargets: draft.dmTargets,
      dmMessage: draft.dmMessage,
      replyMode: draft.replyMode,
      maxPostsPerRun: draft.maxPostsPerRun,
      maxCommentsPerDay: draft.maxCommentsPerDay,
      replyAfter: draft.replyAfter,
      replyNested: draft.replyNested,
      learnPosts: draft.learnPosts,
      enableMemory: draft.enableMemory,
      runOnStart: draft.runOnStart,
      debug: draft.debug,
      enabled: draft.enabled,
      persona: draft.persona,
      llmMode: draft.llmMode,
      llmBaseUrl: draft.llmBaseUrl,
      llmModel: draft.llmModel,
      model: draft.model,
      customPrompt: draft.customPrompt,
      extractUnit: draft.extractUnit,
      extractPrompt: draft.extractPrompt,
    }
    if (String(draft.cookie || '').trim()) patch.cookie = String(draft.cookie).trim()
    if (String(draft.apiKey || '').trim()) patch.llmApiKey = String(draft.apiKey).trim()
    return patch
  }

  // Editing any control schedules a quiet save, so a page refresh does not
  // throw away fields the user forgot to persist with the button.
  function queueSave() {
    if (disposed) return
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = null
      void autoSave()
    }, AUTO_SAVE_DELAY)
  }

  async function autoSave() {
    if (disposed) return
    if (saving) {
      saveAgain = true
      return
    }
    saving = true
    try {
      const data = await api().update({ patch: buildPatch() })
      if (disposed) return
      if (data?.settings) settings = data.settings
      if (data?.status) status = data.status
      if (badgeEl && settings) {
        badgeEl.textContent = settings.enabled ? '自动浏览已开启' : '自动浏览已关闭'
      }
      if (error) {
        error = ''
        rebuild()
      }
    } catch (err) {
      if (disposed) return
      error = err?.message || String(err)
      rebuild()
    } finally {
      saving = false
      if (saveAgain && !disposed) {
        saveAgain = false
        queueSave()
      }
    }
  }

  function save() {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    return run(
      'save',
      async () => {
        const data = await api().update({ patch: buildPatch() })
        // Drop the drafts so the page shows the normalized server values.
        for (const key of Object.keys(draft)) draft[key] = undefined
        draft.scheduleTimes = (data?.settings?.scheduleTimes || []).join(', ')
        draft.cookie = ''
        draft.apiKey = ''
        return data
      },
      () => '设置已保存',
    )
  }

  async function startLogin() {
    if (qrTimer) clearTimeout(qrTimer)
    busy = 'login'
    error = ''
    notice = ''
    rebuild()
    try {
      const data = await api().loginStart({})
      if (disposed) return
      qr = data.qr || ''
      qrState = 'waiting'
      busy = ''
      rebuild()
      pollLogin(data.qrid)
    } catch (err) {
      if (disposed) return
      busy = ''
      setError(err)
    }
  }

  async function pollLogin(qrid, attempt = 0) {
    if (disposed || attempt > 90) return
    try {
      const data = await api().loginPoll({ qrid })
      if (disposed) return
      if (data.state === 'ok') {
        qr = ''
        qrState = 'ok'
        draft.cookie = ''
        if (data.settings) settings = data.settings
        if (data.status) status = data.status
        notice = `已登录${data.account?.screenName ? `：${data.account.screenName}` : ''}`
        rebuild()
        return
      }
      if (data.state === 'expired') {
        qr = ''
        qrState = 'expired'
        rebuild()
        return
      }
      qrState = data.state || 'waiting'
      rebuild()
      qrTimer = setTimeout(() => pollLogin(qrid, attempt + 1), 2000)
    } catch (err) {
      if (disposed) return
      setError(err)
    }
  }

  function logout() {
    return run(
      'logout',
      async () => {
        const data = await api().logout({})
        draft.cookie = ''
        return data
      },
      () => '已退出微博登录',
    )
  }

  function checkNow() {
    return run('check', () => api().run({ mode: 'check' }), (result) => `检查完成：${summaryResult(result)}`)
  }

  function readNow() {
    return run('read', () => api().run({ mode: 'read' }), (result) => `读取完成：${summaryResult(result)}`)
  }

  function replyNow() {
    if (!window.confirm('立即回复会真实发布到微博，确定继续？')) return
    return run('reply', () => api().run({ mode: 'reply' }), (result) => `回复完成：${summaryResult(result)}`)
  }

  function postNow() {
    if (!window.confirm('立即发博会真实发布一条微博，确定继续？')) return
    return run(
      'post',
      () => api().run({ mode: 'post' }),
      (result) => (result.posted ? `已发布：${result.text || ''}` : result.error || '没有发布'),
    )
  }

  function dmSendNow() {
    if (!window.confirm('立即给选中的互关好友发送私信？')) return
    return run(
      'dm',
      () => api().run({ mode: 'dm' }),
      (result) =>
        `已发送 ${result.sent || 0}/${result.targets || 0} 人${result.failed ? `，失败 ${result.failed}` : ''}`,
    )
  }

  function extractNow() {
    if (!window.confirm('快速提取会读取全部往期博文并多次调用模型，确定继续？')) return
    return run('extract', () => api().run({ mode: 'extract' }), (result) =>
      result.started ? '已开始后台提取，可稍后刷新查看进度' : '已有提取任务在运行',
    )
  }

  function renderAccount() {
    const loginButton = el(
      'button',
      { class: 'fw-btn primary', disabled: Boolean(busy), onclick: startLogin },
      busy === 'login' ? '获取二维码…' : qr ? '刷新二维码' : '扫码登录',
    )
    const logoutButton = el(
      'button',
      { class: 'fw-btn', disabled: Boolean(busy) || !settings?.cookieSet, onclick: logout },
      busy === 'logout' ? '退出中…' : '退出登录',
    )
    const qrBox = qr
      ? el(
          'div',
          { class: 'fw-qr' },
          el('img', { src: qr, alt: '微博登录二维码', width: 180, height: 180 }),
          el(
            'p',
            null,
            qrState === 'scanned'
              ? '已扫码，请在手机上确认登录'
              : qrState === 'expired'
                ? '二维码已过期，请刷新'
                : '请用微博 App 扫码',
          ),
        )
      : null

    return card(
      '账号与登录',
      '扫码登录后即可回复评论；Cookie 输入保留为备用方式。',
      el(
        'div',
        { class: 'fw-grid' },
        field(
          '当前账号',
          '扫码成功后自动显示',
          el('input', {
            readonly: true,
            value: settings?.accountName
              ? `${settings.accountName}（${settings.accountUid || '?'}）`
              : settings?.cookieSet
                ? '已登录'
                : '未登录',
          }),
        ),
        field(
          '监控账号 UID',
          '要检查博文评论的目标账号；不是登录的机器人账号',
          el('input', {
            value: draft.targetUid ?? settings?.targetUid ?? '',
            placeholder: '例如 1234567890',
            oninput: (event) => (draft.targetUid = event.target.value),
          }),
        ),
      ),
      el('div', { class: 'fw-actions' }, loginButton, logoutButton),
      qrBox,
      field(
        '微博 Cookie（备用）',
        settings?.cookieSet ? '已保存；留空表示不修改' : '从浏览器复制 SUB、SUBP、XSRF-TOKEN 等 Cookie',
        el('textarea', {
          value: draft.cookie,
          placeholder: settings?.cookieSet ? '已保存，留空不修改' : 'SUB=...; SUBP=...; XSRF-TOKEN=...',
          oninput: (event) => (draft.cookie = event.target.value),
        }),
      ),
    )
  }

  function renderModel() {
    return card(
      'AI 模型',
      '默认复用 OpenCode 当前模型；也可以切换到直连 OpenAI 兼容 API。',
      el(
        'div',
        { class: 'fw-grid' },
        field(
          '模型来源',
          '复用 OpenCode 模型时不需要 API Key',
          el(
            'select',
            { onchange: (event) => (draft.llmMode = event.target.value) },
            el('option', { value: 'opencode', selected: (draft.llmMode ?? settings?.llmMode) !== 'direct' }, '复用 OpenCode 模型'),
            el('option', { value: 'direct', selected: (draft.llmMode ?? settings?.llmMode) === 'direct' }, '直连 API'),
          ),
        ),
        field(
          '使用的模型',
          '复用模式实际调用的模型；默认模型可能受免费额度限制',
          el(
            'select',
            { onchange: (event) => (draft.model = event.target.value) },
            el(
              'option',
              { value: '', selected: (draft.model ?? settings?.model ?? '') === '' },
              'OpenCode 默认模型',
            ),
            models.map((item) =>
              el(
                'option',
                { value: item.id, selected: (draft.model ?? settings?.model ?? '') === item.id },
                `${item.name}（${item.provider}）`,
              ),
            ),
          ),
        ),
        field(
          '接口地址',
          '直连模式使用；自动补 /chat/completions',
          el('input', {
            value: draft.llmBaseUrl ?? settings?.llmBaseUrl ?? '',
            oninput: (event) => (draft.llmBaseUrl = event.target.value),
          }),
        ),
        field(
          '模型名',
          '直连模式使用，例如 deepseek-chat',
          el('input', {
            value: draft.llmModel ?? settings?.llmModel ?? '',
            oninput: (event) => (draft.llmModel = event.target.value),
          }),
        ),
        field(
          'API Key',
          settings?.llmApiKeySet ? '已保存；留空表示不修改' : '仅直连模式需要',
          el('input', {
            type: 'password',
            value: draft.apiKey,
            placeholder: settings?.llmApiKeySet ? '已保存，留空不修改' : 'sk-...',
            oninput: (event) => (draft.apiKey = event.target.value),
          }),
        ),
      ),
      field(
        '人设',
        '留空使用内置 Foxy 人设；会作为系统提示词',
        el('textarea', {
          value: draft.persona ?? settings?.persona ?? '',
          placeholder: '你是 Foxy……',
          oninput: (event) => (draft.persona = event.target.value),
        }),
      ),
      field(
        '判断提示词（附加）',
        '追加到内置判断提示词后；不要改变 JSON 输出格式',
        el('textarea', {
          value: draft.customPrompt ?? '',
          placeholder: '例如：评论更像日常聊天，不要写长句。',
          oninput: (event) => (draft.customPrompt = event.target.value),
        }),
      ),
    )
  }

  function renderReading() {
    return card(
      '博文阅读与评论',
      '阅读目标账号的博文并写入记忆；仅对设定时间之后的博文发表评论。',
      toggle('启用自动检查', '关闭后定时任务不运行，仍可使用「立即检查」。', draft.enabled === true, (value) => {
        draft.enabled = value
      }),
      el(
        'div',
        { class: 'fw-grid' },
        field(
          '每日检查时间',
          'HH:MM，多个用逗号分隔，最多 6 个',
          el('input', {
            value: draft.scheduleTimes,
            placeholder: '20:00',
            oninput: (event) => (draft.scheduleTimes = event.target.value),
          }),
        ),
        field(
          '评论模式',
          '自动才会发布博文评论；建议先仅检查',
          el(
            'select',
            { onchange: (event) => (draft.replyMode = event.target.value) },
            el('option', { value: 'off', selected: (draft.replyMode ?? settings?.replyMode) !== 'auto' }, '仅检查，不回复'),
            el('option', { value: 'auto', selected: (draft.replyMode ?? settings?.replyMode) === 'auto' }, '自动回复'),
          ),
        ),
        field(
          '浏览范围（博文条数）',
          '1–100，按时间倒序检查',
          el('input', {
            type: 'number',
            min: 1,
            max: 100,
            value: draft.maxPostsPerRun ?? 5,
            oninput: (event) => (draft.maxPostsPerRun = event.target.value),
          }),
        ),
        field(
          '每日评论上限',
          '0–10，仅统计自动评论',
          el('input', {
            type: 'number',
            min: 0,
            max: 10,
            value: draft.maxCommentsPerDay ?? 1,
            oninput: (event) => (draft.maxCommentsPerDay = event.target.value),
          }),
        ),
        field(
          '评论起始时间',
          '只评论此时间之后的博文；留空不限制',
          el('input', {
            type: 'datetime-local',
            value: draft.replyAfter ?? '',
            oninput: (event) => (draft.replyAfter = event.target.value),
          }),
        ),
        field(
          '阅读后写入记忆',
          '每篇未读博文写一条“目标账号博文”记忆',
          el(
            'select',
            { onchange: (event) => (draft.learnPosts = event.target.value === 'on') },
            el('option', { value: 'on', selected: (draft.learnPosts ?? settings?.learnPosts !== false) === true }, '写入'),
            el('option', { value: 'off', selected: (draft.learnPosts ?? settings?.learnPosts !== false) === false }, '不写入'),
          ),
        ),
      ),
      toggle('回复楼中楼', '检查回复 Foxy 评论的楼中楼，并按评论 cid 回复。', draft.replyNested !== false, (value) => {
        draft.replyNested = value
      }),
      toggle('启用微博记忆', '写入本地 memory.jsonl，并作为判断上下文。', draft.enableMemory !== false, (value) => {
        draft.enableMemory = value
      }),
      toggle('启动 OpenCode 后自动运行', '启动约 20 秒后执行一轮。', draft.runOnStart === true, (value) => {
        draft.runOnStart = value
      }),
      toggle('记录调试日志', '保存模型输出与记忆写入结果，便于排查。', draft.debug === true, (value) => {
        draft.debug = value
      }),
      el(
        'div',
        { class: 'fw-actions' },
        actionButton('立即检查博文', '检查中…', busy === 'check', checkNow),
        actionButton('立即读取博文', '读取中…', busy === 'read', readNow),
        actionButton('立即回复', '评论中…', busy === 'reply', replyNow),
        actionButton('保存设置', '保存中…', busy === 'save', save),
      ),
      el(
        'div',
        { class: 'fw-stats' },
        el('div', null, el('strong', null, status?.seen || 0), el('small', null, '已浏览')),
        el('div', null, el('strong', null, status?.commentsToday || 0), el('small', null, '今日评论')),
        el('div', null, el('strong', null, status?.postsSeen || 0), el('small', null, '已处理博文')),
        el('div', null, el('strong', null, formatTime(status?.lastRun)), el('small', null, '上次运行')),
      ),
    )
  }

  function timeList(key) {
    return String(draft[key] || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  }

  function setTimes(key, times) {
    draft[key] = times.join(', ')
    queueSave()
  }

  function addTime(key) {
    const times = timeList(key)
    if (times.length >= 6) return
    times.push('12:00')
    setTimes(key, times)
    rebuild()
  }

  function removeTime(key, index) {
    const times = timeList(key)
    times.splice(index, 1)
    setTimes(key, times)
    rebuild()
  }

  function updateTime(key, index, value) {
    const times = timeList(key)
    const text = String(value || '').trim()
    if (text) times[index] = text
    else times.splice(index, 1)
    draft[key] = times.join(', ')
  }

  function timeField(label, hint, key) {
    return field(
      label,
      hint,
      el(
        'div',
        { class: 'fw-times' },
        timeList(key).map((value, index) =>
          el(
            'div',
            { class: 'fw-time-row' },
            el('input', {
              type: 'time',
              value,
              onchange: (event) => updateTime(key, index, event.target.value),
            }),
            el(
              'button',
              { class: 'fw-btn', type: 'button', onclick: () => removeTime(key, index) },
              '删除',
            ),
          ),
        ),
        el('button', { class: 'fw-btn', type: 'button', onclick: () => addTime(key) }, '添加时间'),
      ),
    )
  }

  function dmTargetList() {
    return String(draft.dmTargets || '')
      .split(/[\s,，]+/)
      .map((item) => item.trim())
      .filter(Boolean)
  }

  function toggleDmTarget(uid, checked) {
    const set = new Set(dmTargetList())
    const id = String(uid)
    if (checked) set.add(id)
    else set.delete(id)
    draft.dmTargets = [...set].join(', ')
    queueSave()
  }

  async function loadFriends() {
    if (friendsLoading) return
    friendsLoading = true
    friendsError = ''
    rebuild()
    try {
      const data = await api().friends({})
      if (disposed) return
      friends = Array.isArray(data?.friends) ? data.friends : []
      friendsLoaded = true
    } catch (err) {
      if (disposed) return
      friendsError = err?.message || String(err)
    } finally {
      if (!disposed) {
        friendsLoading = false
        rebuild()
      }
    }
  }

  function renderDmFriends() {
    if (friendsLoading) return el('p', { class: 'fw-muted' }, '正在加载互关好友…')
    if (friendsError) {
      return el(
        'div',
        null,
        el('p', { class: 'fw-alert fw-error' }, friendsError),
        el('button', { class: 'fw-btn', type: 'button', onclick: loadFriends }, '重试'),
      )
    }
    if (!friendsLoaded) {
      return el(
        'div',
        { class: 'fw-actions' },
        el('button', { class: 'fw-btn', type: 'button', onclick: loadFriends }, '加载互关好友'),
      )
    }
    if (!friends.length) return el('p', { class: 'fw-muted' }, '没有找到互关好友。')
    const selected = new Set(dmTargetList())
    return el(
      'div',
      null,
      el(
        'div',
        { class: 'fw-friends' },
        friends.map((friend) =>
          el(
            'label',
            { class: 'fw-friend' },
            el('input', {
              type: 'checkbox',
              checked: selected.has(String(friend.uid)),
              onchange: (event) => toggleDmTarget(friend.uid, event.target.checked),
            }),
            el('span', null, `${friend.name || friend.uid}（${friend.uid}）`),
          ),
        ),
      ),
      el(
        'div',
        { class: 'fw-actions' },
        el(
          'button',
          { class: 'fw-btn', type: 'button', onclick: loadFriends },
          `刷新好友（已选 ${selected.size}）`,
        ),
      ),
    )
  }

  function renderPost() {
    const last = status?.lastPost
    return card(
      '定时发博',
      '关键词只作为写作要求，不会原样发布；输出为「标题 + 编号条目 + 话题」，自动去掉“待核实”等话术。',
      toggle('启用定时发博', '关闭后不自动发布，仍可使用「立即发博」。', draft.postEnabled === true, (value) => {
        draft.postEnabled = value
      }),
      el(
        'div',
        { class: 'fw-grid' },
        timeField('发博时间', '点击时间上下滚动选择，选完自动保存；最多 6 个', 'postTimes'),
        field(
          '下次发博',
          '修改时间后自动重新计算',
          el('input', {
            readonly: true,
            value: formatTime(status?.nextPostAt),
          }),
        ),
      ),
      field(
        '发博关键词 / 要求',
        '例如：整理 24 小时以内全球新闻 TOP10，每条一句话；正文 400 字以内',
        el('textarea', {
          value: draft.postPrompt ?? '',
          placeholder: '整理24小时以内全球新闻TOP10',
          oninput: (event) => (draft.postPrompt = event.target.value),
        }),
      ),
      toggle(
        '发博前联网搜索',
        '用 OpenCode 的搜索服务补充最新信息；未配置搜索时自动跳过。',
        draft.postSearch !== false,
        (value) => {
          draft.postSearch = value
        },
      ),
      toggle(
        '自动优化提示词',
        '首次发博时把关键词整理成写作方案；关键词不变时复用，不重复调用模型。',
        draft.postOptimize !== false,
        (value) => {
          draft.postOptimize = value
        },
      ),
      settings?.postPromptOptimized
        ? field(
            '优化后的写作方案',
            '上次自动生成；修改关键词后会在下次发博时重新生成',
            el('textarea', { readonly: true, value: settings.postPromptOptimized }),
          )
        : null,
      el('div', { class: 'fw-actions' }, actionButton('立即发博', '发布中…', busy === 'post', postNow)),
      last
        ? el(
            'p',
            { class: 'fw-muted' },
            last.error
              ? `上次发博失败：${last.error}`
              : `上次发博：${formatTime(last.at)}${last.url ? `，${last.url}` : ''}`,
          )
        : null,
    )
  }

  function renderDm() {
    const last = status?.lastDm
    const selectedCount = dmTargetList().length
    return card(
      '定时私信',
      '每天按点把同一条私信发给选中的互关好友；发送前请确认内容和对象。',
      toggle('启用定时私信', '关闭后不自动发送，仍可使用「立即私信」。', draft.dmEnabled === true, (value) => {
        draft.dmEnabled = value
      }),
      el(
        'div',
        { class: 'fw-grid' },
        timeField('私信时间', '点击时间上下滚动选择，选完自动保存；最多 6 个', 'dmTimes'),
        field(
          '下次私信',
          '修改时间后自动重新计算',
          el('input', {
            readonly: true,
            value: formatTime(status?.nextDmAt),
          }),
        ),
      ),
      field(
        '互关好友',
        `已选 ${selectedCount} 人；好友较多时只加载前 8 页`,
        renderDmFriends(),
      ),
      field(
        '私信内容',
        '300 字以内；所有选中好友发送同一内容',
        el('textarea', {
          value: draft.dmMessage ?? '',
          placeholder: '例如：最近降温，记得添衣。',
          oninput: (event) => (draft.dmMessage = event.target.value),
        }),
      ),
      el('div', { class: 'fw-actions' }, actionButton('立即私信', '发送中…', busy === 'dm', dmSendNow)),
      last
        ? el(
            'p',
            { class: 'fw-muted' },
            last.error
              ? `上次私信失败：${last.error}`
              : `上次私信：${formatTime(last.at)}，成功 ${last.sent || 0}/${last.targets || 0}` +
                (last.failed ? `，失败 ${last.failed}` : ''),
          )
        : null,
    )
  }

  function renderExtract() {
    return card(
      '快速提取记忆',
      '一次性读取全部往期博文，按周/月/年分组；每组整合为一条长期记忆。只读不评论。',
      el(
        'div',
        { class: 'fw-grid' },
        field(
          '分组单位',
          '按自然周/月/年分组',
          el(
            'select',
            { onchange: (event) => (draft.extractUnit = event.target.value) },
            el('option', { value: 'week', selected: (draft.extractUnit ?? settings?.extractUnit) === 'week' }, '按周'),
            el('option', { value: 'month', selected: (draft.extractUnit ?? settings?.extractUnit) !== 'week' && (draft.extractUnit ?? settings?.extractUnit) !== 'year' }, '按月'),
            el('option', { value: 'year', selected: (draft.extractUnit ?? settings?.extractUnit) === 'year' }, '按年'),
          ),
        ),
      ),
      field(
        '提取提示词（附加）',
        '追加到内置提取提示词；不要改变 JSON 输出格式',
        el('textarea', {
          value: draft.extractPrompt ?? '',
          placeholder: '例如：重要事件保留日期和人物，普通日常合并概括。',
          oninput: (event) => (draft.extractPrompt = event.target.value),
        }),
      ),
      el(
        'div',
        { class: 'fw-actions' },
        actionButton('开始全量提取', '提取中…', busy === 'extract', extractNow),
      ),
      status?.extracting && status.extractProgress
        ? el(
            'p',
            { class: 'fw-muted' },
            `提取进度：${status.extractProgress.done || 0}/${status.extractProgress.total || 0} 组` +
              (status.extractProgress.current ? `，当前 ${status.extractProgress.current}` : '') +
              `；已写入 ${status.extractProgress.memories || 0} 条`,
          )
        : null,
      status?.lastExtract
        ? el(
            'p',
            { class: 'fw-muted' },
            status.lastExtract.error
              ? `上次提取失败：${status.lastExtract.error}`
              : `上次提取：${status.lastExtract.posts || 0} 篇博文，按${status.lastExtract.unit || ''}分为 ${status.lastExtract.groups || 0} 组，写入 ${status.lastExtract.memories || 0} 条记忆`,
          )
        : null,
    )
  }

  function renderLog() {
    const recent = Array.isArray(status?.recent) ? status.recent : []
    const debugEvents = Array.isArray(status?.debug) ? status.debug : []
    return card(
      '运行与日志',
      '记录阅读过的博文、判断、评论与记忆结果。',
      recent.length
        ? el(
            'div',
            { class: 'fw-log' },
            recent.map((item, index) =>
              el(
                'div',
                { class: 'fw-row', key: `${item.at}-${index}` },
                el('a', { href: item.url || '#', target: '_blank', rel: 'noreferrer' }, item.title || item.post || ''),
                el(
                  'small',
                  null,
                  `${item.author || ''} · ${formatTime(item.at)} · ${item.action || ''}${item.memory ? ` · 记忆 ${item.memory}` : ''}`,
                ),
                item.comment ? el('p', null, item.comment) : null,
                item.error ? el('p', null, item.error) : null,
              ),
            ),
          )
        : el('p', { class: 'fw-muted' }, '暂无运行记录。'),
      debugEvents.length
        ? el(
            'div',
            { class: 'fw-debug' },
            debugEvents.map((event, index) =>
              el(
                'div',
                { class: 'fw-row', key: `${event.at}-${index}` },
                el(
                  'small',
                  null,
                  `${formatTime(event.at)} · ${event.kind || 'event'}${event.post ? ` · ${event.post}` : ''}`,
                ),
                el(
                  'p',
                  null,
                  [event.action ? `动作 ${event.action}` : '', event.memory || '', event.reason || '']
                    .filter(Boolean)
                    .join(' · '),
                ),
                event.raw ? el('pre', null, event.raw) : null,
              ),
            ),
          )
        : null,
    )
  }

  function rebuild() {
    root.replaceChildren()
    if (!settings) {
      root.append(el('p', { class: 'fw-muted' }, error || '正在读取微博设置…'))
      return
    }
    const badge = el('span', { class: 'fw-badge' }, settings.enabled ? '自动浏览已开启' : '自动浏览已关闭')
    badgeEl = badge
    root.append(
      el(
        'div',
        { class: 'fw-head' },
        el(
          'div',
          null,
          el('p', { class: 'fw-eyebrow' }, 'FOXY EXTENSION'),
          el('h1', null, '微博评论'),
          el('p', null, '按当前预设关注微博账号，阅读、判断、评论并写入本地记忆。'),
        ),
        badge,
      ),
      renderAccount(),
      renderModel(),
      renderReading(),
      renderPost(),
      renderDm(),
      renderExtract(),
      renderLog(),
      error ? el('p', { class: 'fw-alert fw-error' }, error) : null,
      notice ? el('p', { class: 'fw-alert fw-ok' }, notice) : null,
      el('p', { class: 'fw-muted' }, '微博评论有账号风控风险。建议先观察检查结果，再开启自动评论。'),
    )
  }

  // Defaults are filled from the first status response; keep the drafts in
  // sync before the first save.
  const originalRebuild = rebuild
  rebuild = function rebuildWithDrafts() {
    if (settings) {
      draft.targetUid = draft.targetUid ?? settings.targetUid ?? ''
      draft.postEnabled = draft.postEnabled ?? settings.postEnabled === true
      draft.postTimes = draft.postTimes ?? (settings.postTimes || []).join(', ')
      draft.postPrompt = draft.postPrompt ?? settings.postPrompt ?? ''
      draft.postSearch = draft.postSearch ?? settings.postSearch !== false
      draft.postOptimize = draft.postOptimize ?? settings.postOptimize !== false
      draft.dmEnabled = draft.dmEnabled ?? settings.dmEnabled === true
      draft.dmTimes = draft.dmTimes ?? (settings.dmTimes || []).join(', ')
      draft.dmTargets = draft.dmTargets ?? settings.dmTargets ?? ''
      draft.dmMessage = draft.dmMessage ?? settings.dmMessage ?? ''
      draft.replyMode = draft.replyMode ?? settings.replyMode ?? 'off'
      draft.maxPostsPerRun = draft.maxPostsPerRun ?? settings.maxPostsPerRun ?? 5
      draft.maxCommentsPerDay = draft.maxCommentsPerDay ?? settings.maxCommentsPerDay ?? 1
      draft.replyAfter = draft.replyAfter ?? settings.replyAfter ?? ''
      draft.replyNested = draft.replyNested ?? settings.replyNested !== false
      draft.learnPosts = draft.learnPosts ?? settings.learnPosts !== false
      draft.enableMemory = draft.enableMemory ?? settings.enableMemory !== false
      draft.runOnStart = draft.runOnStart ?? settings.runOnStart === true
      draft.debug = draft.debug ?? settings.debug === true
      draft.enabled = draft.enabled ?? settings.enabled === true
      draft.persona = draft.persona ?? settings.persona ?? ''
      draft.llmMode = draft.llmMode ?? settings.llmMode ?? 'opencode'
      draft.llmBaseUrl = draft.llmBaseUrl ?? settings.llmBaseUrl ?? ''
      draft.llmModel = draft.llmModel ?? settings.llmModel ?? ''
      draft.model = draft.model ?? settings.model ?? ''
      draft.customPrompt = draft.customPrompt ?? settings.customPrompt ?? ''
      draft.extractUnit = draft.extractUnit ?? settings.extractUnit ?? 'month'
      draft.extractPrompt = draft.extractPrompt ?? settings.extractPrompt ?? ''
    }
    originalRebuild()
  }

  rebuild()
  void refresh()
  return root
}

module.exports = Plugin.define({
  setup(ctx) {
    const style = document.createElement('style')
    style.setAttribute('data-plugin', 'foxy-weibo')
    style.textContent = CSS
    document.head.appendChild(style)

    ctx.add(SettingsPage, {
      id: 'foxy-weibo',
      get title() {
        return '微博'
      },
      get entries() {
        return [
          { id: 'account', title: '微博账号', description: '扫码登录、Cookie、监控账号 UID' },
          { id: 'model', title: '微博 AI 模型', description: '复用 OpenCode 模型或直连 API' },
          { id: 'reading', title: '微博阅读与评论', description: '定时检查、评论模式、楼中楼回复' },
          { id: 'post', title: '微博定时发博', description: '按时间用模型生成并发布微博' },
          { id: 'dm', title: '微博定时私信', description: '按时间给互关好友发送私信' },
          { id: 'extract', title: '微博记忆提取', description: '按周/月/年整理往期博文' },
        ]
      },
      render: () => makeView(ctx),
    })

    return () => style.remove()
  },
})
