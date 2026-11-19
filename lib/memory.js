import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { foxyHome } from './settings.js'

/**
 * Local memory for Weibo events.
 *
 * OpenCode has no foxyMemory provider, so the plugin keeps an append-only
 * JSONL file. It is readable by hand and can be injected into judge prompts.
 */
export function memoryPath(config = {}) {
  return config.memoryFile || join(foxyHome(), 'memory.jsonl')
}

function readEntries(file, limit = Infinity) {
  if (!existsSync(file)) return []
  const entries = []
  try {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/)
    for (const line of lines) {
      const text = line.trim()
      if (!text) continue
      try {
        entries.push(JSON.parse(text))
      } catch {
        // Skip a partial line left by an interrupted write.
      }
    }
  } catch {
    return []
  }
  return limit === Infinity ? entries : entries.slice(-limit)
}

export function createMemoryStore(config = {}) {
  const file = memoryPath(config)

  return {
    file,

    async record(event) {
      const entry = { at: Date.now(), ...event }
      mkdirSync(dirname(file), { recursive: true })
      appendFileSync(file, `${JSON.stringify(entry)}\n`, 'utf8')
      return { ok: true }
    },

    async context({ limit = 8 } = {}) {
      const entries = readEntries(file, Math.max(1, Number(limit) || 8))
      return entries
        .map((entry) => {
          const when = entry.at ? new Date(entry.at).toISOString().slice(0, 10) : ''
          return `- ${when ? `[${when}] ` : ''}${entry.text || ''}`
        })
        .filter((line) => line.trim() !== '-')
        .join('\n')
    },

    async search(query = '', limit = 5) {
      const needle = String(query || '').trim().toLowerCase()
      const entries = readEntries(file)
        .filter((entry) => !needle || String(entry.text || '').toLowerCase().includes(needle))
        .slice(-Math.max(1, Number(limit) || 5))
        .reverse()
      return entries.map((entry) => ({
        at: entry.at || 0,
        text: entry.text || '',
        eventType: entry.eventType || '',
        channelId: entry.channelId || '',
        url: entry.url || '',
      }))
    },
  }
}
