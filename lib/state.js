import { closeSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { foxyHome } from './settings.js'

export function statePath() {
  return join(foxyHome(), 'state.json')
}

export function loadState() {
  try {
    const parsed = JSON.parse(readFileSync(statePath(), 'utf8'))
    return {
      seen: parsed.seen && typeof parsed.seen === 'object' ? parsed.seen : {},
      commentSeen:
        parsed.commentSeen && typeof parsed.commentSeen === 'object' ? parsed.commentSeen : {},
      postSeen: parsed.postSeen && typeof parsed.postSeen === 'object' ? parsed.postSeen : {},
      postMemory:
        parsed.postMemory && typeof parsed.postMemory === 'object' ? parsed.postMemory : {},
      days: parsed.days && typeof parsed.days === 'object' ? parsed.days : {},
      history: Array.isArray(parsed.history) ? parsed.history.slice(0, 50) : [],
      debug: Array.isArray(parsed.debug) ? parsed.debug.slice(0, 80) : [],
      lastRun: Number(parsed.lastRun) || 0,
      lastResult: parsed.lastResult || null,
      digests: parsed.digests && typeof parsed.digests === 'object' ? parsed.digests : {},
      extracting: parsed.extracting === true,
      extractProgress: parsed.extractProgress || null,
      lastExtract: parsed.lastExtract || null,
      judgeSessionId: typeof parsed.judgeSessionId === 'string' ? parsed.judgeSessionId : '',
    }
  } catch {
    return {
      seen: {},
      commentSeen: {},
      postSeen: {},
      postMemory: {},
      days: {},
      history: [],
      debug: [],
      lastRun: 0,
      lastResult: null,
      digests: {},
      extracting: false,
      extractProgress: null,
      lastExtract: null,
      judgeSessionId: '',
    }
  }
}

export function saveState(state) {
  const file = statePath()
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
}

const STATE_LOCK_STALE_MS = 5 * 60 * 1000

function stateLockPath() {
  return `${statePath()}.lock`
}

export function acquireStateLock() {
  const file = stateLockPath()
  mkdirSync(dirname(file), { recursive: true })
  try {
    const fd = openSync(file, 'wx')
    writeFileSync(fd, `${process.pid}\n`, 'utf8')
    closeSync(fd)
    return true
  } catch (error) {
    if (error?.code !== 'EEXIST') return false
    try {
      if (Date.now() - statSync(file).mtimeMs > STATE_LOCK_STALE_MS) {
        unlinkSync(file)
        return acquireStateLock()
      }
    } catch {
      // Another process may have removed it between stat and unlink.
    }
    return false
  }
}

export function releaseStateLock() {
  try {
    unlinkSync(stateLockPath())
  } catch {
    // Already gone.
  }
}

export function today() {
  return new Date().toISOString().slice(0, 10)
}

export function commentCount(state) {
  return Number(state.days?.[today()]?.comments || 0)
}

export function bumpComments(state) {
  const day = today()
  if (!state.days[day]) state.days[day] = { comments: 0 }
  state.days[day].comments += 1
}

export function pushHistory(state, entry) {
  state.history = [entry, ...(Array.isArray(state.history) ? state.history : [])].slice(0, 50)
}

export function debugLog(state, config, event) {
  if (config.debug !== true) return
  state.debug = [{ at: Date.now(), ...event }, ...(Array.isArray(state.debug) ? state.debug : [])].slice(0, 80)
}
