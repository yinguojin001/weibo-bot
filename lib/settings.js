import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const DEFAULTS = {
  enabled: false,
  cookie: '',
  targetUid: '',
  replyMode: 'off',
  replyAfter: '',
  replyNested: true,
  learnPosts: true,
  scheduleTimes: ['20:00'],
  postEnabled: false,
  postTimes: ['08:00'],
  postPrompt: '',
  maxPostsPerRun: 5,
  maxCommentsPerDay: 1,
  enableMemory: true,
  persona: '',
  llmMode: 'opencode',
  llmBaseUrl: 'https://api.deepseek.com',
  llmModel: 'deepseek-chat',
  llmApiKey: '',
  model: '',
  customPrompt: '',
  extractUnit: 'month',
  extractCount: 1,
  extractStart: '',
  extractEnd: '',
  extractPrompt: '',
  runOnStart: false,
  debug: false,
}

export const SETTING_KEYS = [
  'enabled',
  'targetUid',
  'replyMode',
  'replyAfter',
  'replyNested',
  'learnPosts',
  'scheduleTimes',
  'postEnabled',
  'postTimes',
  'postPrompt',
  'maxPostsPerRun',
  'maxCommentsPerDay',
  'enableMemory',
  'persona',
  'llmMode',
  'llmBaseUrl',
  'llmModel',
  'model',
  'customPrompt',
  'extractUnit',
  'extractCount',
  'extractStart',
  'extractEnd',
  'extractPrompt',
  'runOnStart',
  'debug',
]

const TEXT_KEYS = new Set([
  'targetUid',
  'replyAfter',
  'replyMode',
  'persona',
  'postPrompt',
  'llmMode',
  'llmBaseUrl',
  'llmModel',
  'model',
  'customPrompt',
  'extractUnit',
  'extractStart',
  'extractEnd',
  'extractPrompt',
])
const BOOLEAN_KEYS = new Set([
  'enabled',
  'postEnabled',
  'replyNested',
  'learnPosts',
  'enableMemory',
  'runOnStart',
  'debug',
])

/**
 * OpenCode stores configuration under the XDG config directory. The plugin
 * keeps its own settings and state beside that configuration so it survives
 * server restarts and can be inspected by hand.
 */
export function opencodeConfigHome() {
  if (process.env.OPENCODE_CONFIG_DIR) return process.env.OPENCODE_CONFIG_DIR
  if (process.env.XDG_CONFIG_HOME) return join(process.env.XDG_CONFIG_HOME, 'opencode')
  return join(homedir(), '.config', 'opencode')
}

export function foxyHome() {
  return process.env.OPENCODE_WEIBO_HOME || join(opencodeConfigHome(), 'foxy-weibo')
}

export function settingsPath() {
  return join(foxyHome(), 'settings.json')
}

function legacySettingsPath() {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'foxy-weibo', 'settings.json')
}

export function normalizeUids(value) {
  const raw = Array.isArray(value) ? value : String(value || '').split(/[\s,，]+/)
  const out = []
  for (const item of raw) {
    const uid = String(item || '').trim()
    if (!/^\d{5,20}$/.test(uid) || out.includes(uid)) continue
    out.push(uid)
    if (out.length >= 20) break
  }
  return out
}

export function normalizeScheduleTimes(value) {
  const raw = Array.isArray(value) ? value : String(value || '').split(/[\s,，]+/)
  const out = []
  for (const item of raw) {
    const text = String(item || '').trim()
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(text) || out.includes(text)) continue
    out.push(text)
    if (out.length >= 6) break
  }
  return out.sort()
}

function clampNumber(key, value, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  if (key === 'maxPostsPerRun') return Math.max(1, Math.min(100, Math.round(n)))
  if (key === 'maxCommentsPerDay') return Math.max(0, Math.min(10, Math.round(n)))
  if (key === 'extractCount') return Math.max(1, Math.min(365, Math.round(n)))
  return n
}

export function normalizePatch(current = {}, patch = {}) {
  const next = { ...DEFAULTS, ...current }
  for (const key of SETTING_KEYS) {
    if (patch[key] === undefined || key === 'scheduleTimes' || key === 'postTimes') continue
    if (BOOLEAN_KEYS.has(key)) next[key] = patch[key] === true
    else if (TEXT_KEYS.has(key)) next[key] = String(patch[key] ?? '').trim()
    else next[key] = clampNumber(key, patch[key], next[key])
  }
  if (patch.scheduleTimes !== undefined) next.scheduleTimes = normalizeScheduleTimes(patch.scheduleTimes)
  if (patch.postTimes !== undefined) next.postTimes = normalizeScheduleTimes(patch.postTimes)
  if (patch.cookie !== undefined) next.cookie = String(patch.cookie || '')
  if (patch.clearCookie === true) next.cookie = ''
  if (typeof patch.accountName === 'string') next.accountName = patch.accountName.trim()
  if (typeof patch.accountUid === 'string') next.accountUid = patch.accountUid.trim()
  if (typeof patch.llmApiKey === 'string' && patch.llmApiKey.trim()) {
    next.llmApiKey = patch.llmApiKey.trim()
  }
  if (patch.clearLlmApiKey === true) next.llmApiKey = ''
  next.enabled = next.enabled === true
  next.replyNested = next.replyNested !== false
  next.learnPosts = next.learnPosts !== false
  next.enableMemory = next.enableMemory !== false
  next.replyMode = next.replyMode === 'auto' ? 'auto' : 'off'
  next.llmMode = next.llmMode === 'direct' ? 'direct' : 'opencode'
  next.extractUnit = ['week', 'month', 'year'].includes(next.extractUnit) ? next.extractUnit : 'month'
  next.scheduleTimes = normalizeScheduleTimes(next.scheduleTimes)
  next.postTimes = normalizeScheduleTimes(next.postTimes)
  for (const legacy of [
    'targetUids',
    'replyOwnPosts',
    'replyOthers',
    'commentMode',
    'intervalMinutes',
    'selfUid',
    'memoryPresetId',
    'presetPath',
    'presetId',
  ]) {
    delete next[legacy]
  }
  return next
}

export function loadSettings(base = {}) {
  let next = normalizePatch(DEFAULTS, base)
  let file = settingsPath()
  if (!existsSync(file) && existsSync(legacySettingsPath())) file = legacySettingsPath()
  try {
    if (existsSync(file)) {
      const parsed = JSON.parse(readFileSync(file, 'utf8'))
      // Migrate 0.2.x/0.3.x fields without keeping the old modes in the model.
      const legacyTarget = Array.isArray(parsed.targetUids) ? parsed.targetUids[0] : ''
      const migratedTarget = legacyTarget || parsed.selfUid || ''
      next = normalizePatch(next, {
        ...parsed,
        ...(migratedTarget && !parsed.targetUid ? { targetUid: migratedTarget } : {}),
      })
      if (typeof parsed.cookie === 'string') next.cookie = parsed.cookie
      if (typeof parsed.llmApiKey === 'string') next.llmApiKey = parsed.llmApiKey
    }
  } catch {}
  return next
}

export function saveSettings(settings) {
  const file = settingsPath()
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
  return file
}

export function publicSettings(settings) {
  const out = {}
  for (const key of SETTING_KEYS) out[key] = settings[key]
  out.cookieSet = Boolean(settings.cookie)
  out.llmApiKeySet = Boolean(settings.llmApiKey)
  out.accountName = settings.accountName || ''
  out.accountUid = settings.accountUid || ''
  return out
}
