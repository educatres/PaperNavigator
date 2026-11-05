import type { AnalysisUsage, ModelInfo, PdfDocumentData, ProviderConfig } from '../../domain/types'
import { pagesForPrompt } from '../../pdf/pdfClient'
import { SYSTEM_INSTRUCTIONS, wrapUntrusted } from '../security'

export const GOOGLE_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'
export const CGU_BASE_URL = 'https://air.cgu.edu.tw/cgullmapi/v1'

interface RawGeneration {
  text: string
  usage: AnalysisUsage
}

const wait = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds))

function readableHttpError(status: number, detail: string) {
  const labels: Record<number, string> = {
    400: '請求格式或模型輸入不受支援', 401: 'API Key 無效或遺失', 403: '權限不足或配額已用完',
    404: '模型或 API 路由不存在', 413: 'PDF 或請求內容太大', 429: '請求過多或已達配額',
    500: 'AI 服務發生錯誤', 503: 'AI 服務暫時無法使用',
  }
  return `${labels[status] ?? `HTTP ${status}`}：${detail || '沒有更多錯誤資訊。'}`
}

async function responseBody(response: Response) {
  const text = await response.text()
  try { return text ? JSON.parse(text) : {} } catch { return { raw: text } }
}

async function fetchWithRetry(url: string, init: RequestInit, externalSignal?: AbortSignal) {
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort('timeout'), 240_000)
    const abort = () => controller.abort(externalSignal?.reason)
    externalSignal?.addEventListener('abort', abort, { once: true })
    try {
      const response = await fetch(url, { ...init, signal: controller.signal })
      if (response.ok) return responseBody(response)
      const body = await responseBody(response)
      const detail = body?.error?.message ?? body?.message ?? body?.raw ?? ''
      if (![429, 500, 503].includes(response.status) || attempt === 2) throw new Error(readableHttpError(response.status, String(detail)))
      const retryAfter = Number(response.headers.get('Retry-After'))
      const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : (700 * (2 ** attempt)) + Math.random() * 350
      await wait(delay)
    } catch (error) {
      lastError = error
      if (externalSignal?.aborted) throw new DOMException('分析已取消。', 'AbortError')
      if (error instanceof Error && /API Key|權限|請求格式|不存在|內容太大/.test(error.message)) throw error
      if (attempt === 2) {
        if (error instanceof DOMException && error.name === 'AbortError') throw new Error('API 請求逾時，請重試或改用較快的模型。')
        if (error instanceof TypeError) throw new Error('無法連線到 API。請檢查網路、Base URL 與瀏覽器 CORS 設定。')
        throw error
      }
      await wait(600 * (2 ** attempt) + Math.random() * 250)
    } finally {
      window.clearTimeout(timeout)
      externalSignal?.removeEventListener('abort', abort)
    }
  }
  throw lastError
}

function googleHeaders(key: string) {
  return { 'Content-Type': 'application/json', 'x-goog-api-key': key }
}

function bearerHeaders(key: string) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }
}

export async function listModels(config: ProviderConfig, signal?: AbortSignal): Promise<ModelInfo[]> {
  if (!config.apiKey.trim()) throw new Error('請先輸入 API Key。')
  const base = config.baseUrl.replace(/\/$/, '')
  if (config.id === 'google') {
    const body = await fetchWithRetry(`${base}/models?pageSize=1000`, { headers: googleHeaders(config.apiKey) }, signal)
    return (body.models ?? [])
      .filter((model: any) => (model.supportedGenerationMethods ?? []).includes('generateContent'))
      .map((model: any) => ({ id: String(model.name ?? '').replace(/^models\//, ''), displayName: String(model.displayName ?? model.name ?? '') }))
      .filter((model: ModelInfo) => model.id && /gemini/i.test(model.id))
  }
  const body = await fetchWithRetry(`${base}/models`, { headers: bearerHeaders(config.apiKey) }, signal)
  const rows = Array.isArray(body) ? body : body.data ?? body.models ?? []
  return rows.map((model: any) => ({ id: String(model.id ?? model.name ?? ''), displayName: String(model.displayName ?? model.id ?? model.name ?? '') }))
    .filter((model: ModelInfo) => model.id && !/(image|embedding|transcri|speech|tts|realtime|whisper)/i.test(`${model.id} ${model.displayName}`))
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) binary += String.fromCharCode(...bytes.subarray(index, Math.min(index + chunk, bytes.length)))
  return btoa(binary)
}

function googleText(body: any) {
  return body.candidates?.[0]?.content?.parts?.map((part: any) => part.text ?? '').join('') ?? ''
}

function responsesText(body: any) {
  if (typeof body.output_text === 'string') return body.output_text
  return (body.output ?? []).flatMap((item: any) => item.content ?? []).map((part: any) => part.text ?? '').join('')
}

function usageFromGoogle(body: any): AnalysisUsage {
  const usage = body.usageMetadata ?? {}
  return { inputTokens: usage.promptTokenCount ?? null, outputTokens: usage.candidatesTokenCount ?? null, totalTokens: usage.totalTokenCount ?? null }
}

function usageFromOpenAi(body: any): AnalysisUsage {
  const usage = body.usage ?? {}
  const inputTokens = usage.input_tokens ?? usage.prompt_tokens ?? null
  const outputTokens = usage.output_tokens ?? usage.completion_tokens ?? null
  return { inputTokens, outputTokens, totalTokens: usage.total_tokens ?? (inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null) }
}

export async function generateStructured(
  config: ProviderConfig,
  document: PdfDocumentData,
  prompt: string,
  schema: object,
  signal?: AbortSignal,
): Promise<RawGeneration> {
  if (!config.apiKey.trim() || !config.modelId) throw new Error('請先測試連線並選擇模型。')
  const base = config.baseUrl.replace(/\/$/, '')
  if (config.id === 'google') {
    const body = await fetchWithRetry(`${base}/models/${encodeURIComponent(config.modelId)}:generateContent`, {
      method: 'POST', headers: googleHeaders(config.apiKey),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTIONS }] },
        contents: [{ role: 'user', parts: [
          { inlineData: { mimeType: 'application/pdf', data: bytesToBase64(document.bytes) } },
          { text: prompt },
        ] }],
        generationConfig: { temperature: 0.1, responseMimeType: 'application/json', responseJsonSchema: schema },
      }),
    }, signal)
    const text = googleText(body)
    if (!text) throw new Error('模型已回應，但沒有 JSON 文字內容。')
    return { text, usage: usageFromGoogle(body) }
  }
  const source = wrapUntrusted('pdf-extracted-text', pagesForPrompt(document))
  const input = `${prompt}\n\n以下為 PDF.js 本機擷取的逐頁文字；頁面標記是引用定位依據：\n${source}`
  if (/luna/i.test(config.modelId)) {
    const body = await fetchWithRetry(`${base}/responses`, {
      method: 'POST', headers: bearerHeaders(config.apiKey),
      body: JSON.stringify({ model: config.modelId, instructions: SYSTEM_INSTRUCTIONS, input, max_output_tokens: 8192, reasoning: { effort: 'medium' } }),
    }, signal)
    const text = responsesText(body)
    if (!text) throw new Error('模型已回應，但沒有 JSON 文字內容。')
    return { text, usage: usageFromOpenAi(body) }
  }
  const body = await fetchWithRetry(`${base}/chat/completions`, {
    method: 'POST', headers: bearerHeaders(config.apiKey),
    body: JSON.stringify({ model: config.modelId, messages: [{ role: 'system', content: SYSTEM_INSTRUCTIONS }, { role: 'user', content: input }], max_completion_tokens: 8192 }),
  }, signal)
  const text = body.choices?.[0]?.message?.content ?? ''
  if (!text) throw new Error('模型已回應，但沒有 JSON 文字內容。')
  return { text, usage: usageFromOpenAi(body) }
}

export async function analyzeImageRegion(config: ProviderConfig, dataUrl: string, prompt: string, signal?: AbortSignal) {
  const base = config.baseUrl.replace(/\/$/, '')
  if (config.id === 'google') {
    const data = dataUrl.split(',')[1] ?? ''
    const body = await fetchWithRetry(`${base}/models/${encodeURIComponent(config.modelId)}:generateContent`, {
      method: 'POST', headers: googleHeaders(config.apiKey),
      body: JSON.stringify({ systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTIONS }] }, contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'image/png', data } }, { text: prompt }] }] }),
    }, signal)
    return googleText(body)
  }
  const body = await fetchWithRetry(`${base}/chat/completions`, {
    method: 'POST', headers: bearerHeaders(config.apiKey),
    body: JSON.stringify({ model: config.modelId, messages: [{ role: 'system', content: SYSTEM_INSTRUCTIONS }, { role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: dataUrl } }] }], max_completion_tokens: 2048 }),
  }, signal)
  return body.choices?.[0]?.message?.content ?? ''
}
