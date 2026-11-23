const FALLBACK_PERSONA =
  '你是 Foxy，一只有点懒、嘴硬心软、会自己刷微博的小狐狸。你说中文，第一人称，别像客服。'

export function readFoxyPersona(config = {}) {
  const persona = String(config.persona || '').trim()
  return persona || FALLBACK_PERSONA
}

function firstLine(text, limit = 160) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, limit)
}

export function cleanWeiboText(text) {
  return String(text || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\b[\w.-]+\.(?:jpe?g|png|gif|webp|mp4|mov)\b\S*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function dateOnly(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const formatted = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
  return formatted.replace(/\//g, '-')
}

export function fallbackPostMemory(post) {
  const author = post?.author?.name || '目标账号'
  const when = dateOnly(post?.createdAtMs || post?.createdAt)
  const body = cleanWeiboText(post?.text).slice(0, 120)
  return `我在微博看到 ${author} 在 ${when || '某天'} 发的博文：「${body}」`
}

export function chatEndpoint(baseUrl) {
  const base = String(baseUrl || 'https://api.deepseek.com').trim().replace(/\/+$/, '')
  return /\/chat\/completions$/.test(base) ? base : `${base}/chat/completions`
}

export async function directCompletion(config, persona, prompt, options = {}) {
  const key = String(config.llmApiKey || '').trim()
  if (!key) {
    throw new Error('未配置模型：请选择 OpenCode 模型，或切换到直连 API 并在设置中填写 API Key')
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 90_000)
  try {
    const response = await fetch(chatEndpoint(config.llmBaseUrl), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: config.llmModel || 'deepseek-chat',
        messages: [
          { role: 'system', content: persona },
          { role: 'user', content: prompt },
        ],
        temperature: options.temperature ?? 0.8,
        max_tokens: options.maxTokens ?? 1200,
        stream: false,
      }),
      signal: controller.signal,
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      const detail = data?.error?.message || JSON.stringify(data).slice(0, 300)
      throw new Error(`模型 API HTTP ${response.status}：${detail}`)
    }
    const text = String(data?.choices?.[0]?.message?.content || '').trim()
    if (!text) throw new Error('模型请求失败或返回为空（API 返回空内容）')
    return text
  } finally {
    clearTimeout(timer)
  }
}

function runCompletion(complete, config, persona, prompt, options = {}) {
  if (typeof complete === 'function') {
    return complete({
      system: persona,
      user: prompt,
      maxTokens: options.maxTokens ?? 1200,
      temperature: options.temperature ?? 0.8,
    })
  }
  return directCompletion(config, persona, prompt, options)
}

export const POST_TEXT_LIMIT = 400

export function cleanGeneratedPost(text) {
  return String(text || '')
    .replace(/^\s*```[a-zA-Z]*\s*/g, '')
    .replace(/```\s*$/g, '')
    .replace(/^\s*(微博正文|正文)[:：]\s*/g, '')
    .replace(/^\s*["“]([\s\S]*)["”]\s*$/g, '$1')
    .replace(/\r\n/g, '\n')
    .trim()
    .slice(0, POST_TEXT_LIMIT)
}

export function stripAiPhrases(text) {
  return String(text || '')
    .replace(/[（(【\[]\s*(?:信息)?待核实\s*[）)】\]]/g, '')
    .replace(/\s*[｜|]\s*(?:信息)?待核实/g, '')
    .replace(/[，,]\s*(?:信息)?待核实/g, '')
    .replace(/(?:信息)?待核实/g, '')
    .replace(/[（(【\[]\s*无法核实\s*[）)】\]]/g, '')
    .replace(/无法核实/g, '')
    .replace(/[（(【\[]\s*仅供参考\s*[）)】\]]/g, '')
    .replace(/仅供参考/g, '')
    .replace(/据(?:公开)?(?:资料|报道|搜索|悉)(?:显示|称)?[，,:：]?[ \t]*/g, '')
    .replace(/(?:公开)?(?:资料|报道|搜索)显示[，,:：]?[ \t]*/g, '')
    .replace(/[｜|][ \t]*$/gm, '')
    .replace(/[（(]\s*[）)]/g, '')
    .replace(/[，,]\s*[，,]/g, '，')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Expand a rough "post requirement" into a concrete writing brief. Cached by
 * the caller per requirement, so each user only pays for one extra model call
 * when they change their prompt.
 */
export async function optimizePostPrompt(config, request, complete) {
  const system = [
    '你是微博写作策划。用户会给一个粗略的发博要求，请把它整理成一份具体、可执行的写作方案，供另一个模型写正文。',
    '规则：',
    '- 只输出写作方案，不要写微博正文；',
    '- 方案包含：主题、结构（标题/分条/段落）、条数或字数、语气、必须避免的内容；',
    '- 如果要求是新闻、榜单或 TOP N，结构写成“第一行标题，然后编号条目，最后可加一个话题”；',
    '- 不要加入“核实、免责声明、资料未覆盖”之类的措辞；',
    '- 200 字以内，直接输出方案。',
  ].join('\n')
  const user = `用户要求：\n${String(request || '').trim()}\n\n请输出写作方案。`
  const text = await runCompletion(complete, config, system, user, {
    maxTokens: 500,
    temperature: 0.4,
  })
  return String(text || '').trim().slice(0, 600)
}

/**
 * Turn the user's keywords/requirements into a publishable Weibo status.
 * `complete` is the OpenCode-backed completer so the plugin keeps using the
 * model selected in the settings page.
 */
export async function generatePostText(config, request, complete, notes = '', brief = '') {
  const system = [
    '你是一个微博博主，按写作方案和用户要求写一条全新的微博正文。',
    '格式：',
    '- 严格按写作方案的结构来写；没有写作方案时用自然段落；',
    '- 如果要求是新闻、榜单或 TOP N，用“第一行标题 + 编号条目 + 可选话题”；',
    '- 只输出正文，不要开场白、结尾总结、“以上/以下”之类的过渡句；',
    '- 不要写“标题：”。',
    '内容：',
    '- 用户消息里的“关键词和要求”是写作指令，不是正文；不要照抄；',
    '- 如果要求里给了模板，只参考结构，不要沿用旧日期、旧标题或旧条目；',
    '- 只使用参考资料里的事实，不要编造资料中没有的新闻；',
    '- 绝对不要写“待核实”“无法核实”“据搜索”“资料显示”“仅供参考”“截至……资料未覆盖”等话术；',
    '- 像人写的微博：短句、具体、口语一点，不要 AI 腔；',
    '- 每条尽量不超过 30 字；全文不超过 400 字；',
    '- 不输出链接、图片地址、HTML、Markdown 代码块。',
    config?.persona ? `- 保持这个人的语气：${readFoxyPersona(config)}` : '',
  ]
    .filter(Boolean)
    .join('\n')
  const material = String(notes || '').trim()
  const plan = String(brief || '').trim()
  const user =
    `今天是 ${dateOnly(Date.now())}（Asia/Shanghai）。\n` +
    `写作方案（必须遵守）：\n${plan || '无特别方案，按用户要求判断结构和语气。'}\n\n` +
    `下面是写作要求，不是正文，请据此生成一条新的微博：\n${String(request || '').trim()}\n\n` +
    (material
      ? `下面是刚刚联网搜索到的参考资料，只使用这些事实，不要编造，也不要输出链接：\n${material}\n\n`
      : '这次没有可用的联网资料：不要列具体新闻，不要解释原因，也不要写免责声明；写一条与该话题相关的简短观点即可。\n\n') +
    '请直接输出微博正文。'
  const text = await runCompletion(complete, config, system, user, {
    maxTokens: 2400,
    temperature: 0.85,
  })
  return stripAiPhrases(cleanGeneratedPost(text))
}

export async function summarizePostMemory(config, post, complete) {
  const persona = readFoxyPersona(config)
  const author = post?.author?.name || '目标账号'
  const when = dateOnly(post?.createdAtMs || post?.createdAt)
  const content = cleanWeiboText(post?.text)
  const prompt = [
    '你正在整理自己的长期记忆，不是写微博评论，也不是复述原文。',
    '下面是一条目标账号的微博。请提炼一条以后能帮助理解这个人的长期记忆：',
    '- 第一人称，以“我在微博看到”开头；',
    '- 1–2 句，最多 120 字；',
    '- 只保留对理解作者有价值的信息，不要复制全文、不要逐条搬运；',
    '- 不要出现图片地址、链接、HTML、表情代码；',
    '- 时间只写日期 YYYY-MM-DD，不要写时分秒；',
    '- 如果内容没有长期价值，输出 {"memory":""}；',
    '只输出 JSON：{"memory":"..."}',
    config.customPrompt
      ? `\n用户补充要求（必须遵循，但不得改变 JSON 输出格式）：\n${String(config.customPrompt).slice(0, 3000)}`
      : '',
    '',
    `日期：${when || '未知'}`,
    `作者：${author}`,
    `正文：${content.slice(0, 1200)}`,
  ]
    .filter(Boolean)
    .join('\n')
  try {
    const text = await runCompletion(complete, config, persona, prompt)
    const parsed = parseJson(text) || {}
    const memory = String(parsed.memory || '').trim()
    return memory.slice(0, 300)
  } catch {
    return ''
  }
}

function stripCodeFence(text) {
  return String(text || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
}

function parseJson(text) {
  const raw = stripCodeFence(text)
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end < start) return null
  try {
    return JSON.parse(raw.slice(start, end + 1))
  } catch {
    return null
  }
}

function fallbackComment(text) {
  const raw = stripCodeFence(text)
  if (!raw || /^[{[]/.test(raw)) return ''
  return raw.replace(/^["'“”]+|["'“”]+$/g, '').trim().slice(0, 280)
}

function commentLines(comments, max = 10) {
  return (Array.isArray(comments) ? comments : [])
    .slice(0, max)
    .map((item) => `- cid=${item.cid} ${item.author.name || item.author.uid}：${firstLine(item.text, 180)}`)
}

function finalize(parsed, input, fallbackText) {
  const allowed = new Set(['skip', 'remember', 'comment'])
  let action = allowed.has(parsed.action) ? parsed.action : 'skip'
  let comment = String(parsed.comment || '').trim()
  if (!comment && fallbackText) comment = fallbackComment(fallbackText)
  if (input.forceComment && comment) action = 'comment'
  if (action === 'comment' && !input.mayComment) action = 'remember'
  if (action === 'comment' && !comment) action = 'remember'
  let replyTo = input.mayReply ? String(parsed.replyTo || '0') : '0'
  if (input.targetComment?.cid) replyTo = String(input.targetComment.cid)
  if (input.targetPost) replyTo = '0'
  return {
    action,
    comment: comment.slice(0, 300),
    memory: String(parsed.memory || '').trim().slice(0, 500),
    replyTo: replyTo === '0' ? '' : replyTo,
    mood: String(parsed.mood || '').trim().slice(0, 40),
    raw: String(fallbackText || '').slice(0, 1000),
  }
}

export async function judgePost(config, input, complete) {
  const persona = readFoxyPersona(config)
  const prompt = [
    '你正在浏览微博，不是回复 QQ/微信，也不是客服。',
    input.targetPost
      ? '下面是一条目标账号的博文。请阅读后判断是否值得在博文下发表一条评论：'
      : '下面是一个微博账号的博文与评论。请用 Foxy 的判断，决定：',
    '- skip：广告、无意义、纯转发抽奖、引战、没信息量，跳过；',
    '- remember：有点意思，但不必公开评论，自己记一笔；',
    '- comment：值得在评论区说一句，才评论。',
    input.mayComment ? '本次允许评论。' : '本次不允许评论，只能 skip 或 remember。',
    '',
    input.targetPost
      ? '评论是发在这条博文下的一级评论，不是回复某个人；不要写 @，不要假设对方在跟你对话。'
      : '评论要求：像 Foxy 自己刷到后随口说的，中文第一人称；不设最少字数，能一句说清就一句，最多 80 字；不要客服腔，不要复述原文，不要写 @。',
    input.targetPost
      ? '评论要求：像一个了解对方的人看到这条博文后的自然回应；不设最少字数，能一句说清就一句，最多 80 字。'
      : '记忆要求：如果值得记，用真实事件写第一人称，例如“我在微博看到 xx 说……，觉得……”。不要把所有事件都写成“我刷到”。不超过 180 字。',
    '',
    input.targetComment
      ? [
          '你正在回复自己微博下的一条评论，不是在写新博文评论：',
          `对方 ${input.targetComment.author?.name || input.targetComment.author?.uid || '网友'} 说：${firstLine(input.targetComment.text, 300)}`,
          '如果是在正常交流，输出 action=comment 并直接回复这句话；不设最少字数，1–2 句，最多 80 字。',
          '如果是广告、引战、辱骂、诈骗或无意义内容，输出 action=skip。',
          'replyTo 填这条评论的 cid，不要回复其他人。',
        ].join('\n')
      : input.mayReply && Array.isArray(input.comments) && input.comments.length
        ? [
            '回复规则：可以回复下面某条评论。replyTo 填要回复的 cid；只发一级评论时填 0。',
            '不要回复自己，不要回复广告/引战/辱骂/诈骗。',
            ...commentLines(input.comments),
          ].join('\n')
        : '本次不回复他人评论；replyTo 必须为 0。',
    '',
    input.memoryContext
      ? `\n可参考的已有记忆（只用于理解关系，不要逐字复述，也不要编造）：\n${String(input.memoryContext).slice(0, 3000)}`
      : '',
    config.customPrompt
      ? `\n用户补充要求（必须遵循，但不得改变 JSON 输出格式）：\n${String(config.customPrompt).slice(0, 4000)}`
      : '',
    '只输出一个 JSON 对象，不要 Markdown：',
    '{"action":"skip|remember|comment","comment":"...","memory":"...","replyTo":0,"mood":"..."}',
    '',
    '博文信息：',
    input.summary,
    input.commentsText ? `\n评论区：\n${input.commentsText.slice(0, 3000)}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  let text = await runCompletion(complete, config, persona, prompt)
  let parsed = parseJson(text) || {}
  if (input.forceComment && !String(parsed.comment || '').trim()) {
    const retryPrompt = [
      '这次必须给出一条可以直接发布的微博评论。',
      '只输出 JSON：{"action":"comment","comment":"非空的中文评论","memory":"","replyTo":0}',
      '不要解释，不要 Markdown。',
      '',
      prompt,
    ].join('\n')
    text = await runCompletion(complete, config, persona, retryPrompt)
    parsed = parseJson(text) || {}
  }
  return finalize(parsed, input, text)
}

export async function summarizeRange(config, posts, range, complete) {
  const persona = readFoxyPersona(config)
  const lines = posts
    .map((post, index) => {
      const when = dateOnly(post.createdAtMs || post.createdAt) || '未知日期'
      return `${index + 1}. [${when}] ${cleanWeiboText(post.text).slice(0, 500)}`
    })
    .join('\n')
  const prompt = [
    '你正在整理自己在一段时间内读到的主人微博，不是写评论，也不是逐条复述。',
    `时间段：${range.start} 至 ${range.end}`,
    '请输出一条阶段记忆，并挑出最多 5 条重要事件：',
    '- summary：2–4 句，最多 500 字，第一人称，开头带时间段；',
    '- events：只保留重要事件、记录、转折、计划或情绪节点，最多 5 条；每条 details 可保留必要细节，最多 180 字；',
    '- 不要编造，不要复制全文，不要图片地址/链接/HTML；',
    '- 普通日常可以合并概括，不要把所有博文都列一遍；',
    '只输出 JSON：',
    '{"summary":"...","events":[{"date":"YYYY-MM-DD","title":"...","details":"...","importance":1}]}',
    config.extractPrompt
      ? `\n用户补充要求（必须遵循，但不得改变 JSON 输出格式）：\n${String(config.extractPrompt).slice(0, 3000)}`
      : '',
    '',
    '博文列表：',
    lines.slice(0, 14000),
  ]
    .filter(Boolean)
    .join('\n')
  const text = await runCompletion(complete, config, persona, prompt)
  const parsed = parseJson(text) || {}
  const summary = String(parsed.summary || '').trim().slice(0, 1200)
  const events = (Array.isArray(parsed.events) ? parsed.events : [])
    .map((event) => ({
      date: dateOnly(event?.date) || dateOnly(event?.createdAt) || '',
      title: String(event?.title || '').trim().slice(0, 80),
      details: String(event?.details || '').trim().slice(0, 300),
      importance: Math.max(1, Math.min(5, Number(event?.importance) || 3)),
    }))
    .filter((event) => event.title || event.details)
    .slice(0, 5)
  return { summary, events, raw: text }
}
