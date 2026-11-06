import type { AnalysisUsage } from '../../domain/types'

export const STRUCTURED_FORMAT_RETRIES = 3
export const STRUCTURED_FORMAT_ATTEMPTS = STRUCTURED_FORMAT_RETRIES + 1

export interface StructuredRetryNotice {
  stage: string
  retry: number
  maxRetries: number
}

interface RawStructuredGeneration {
  text: string
  usage: AnalysisUsage
}

function addTokenCount(current: number | null, next: number | null) {
  return current === null && next === null ? null : (current ?? 0) + (next ?? 0)
}

function addUsage(current: AnalysisUsage, next: AnalysisUsage): AnalysisUsage {
  return {
    inputTokens: addTokenCount(current.inputTokens, next.inputTokens),
    outputTokens: addTokenCount(current.outputTokens, next.outputTokens),
    totalTokens: addTokenCount(current.totalTokens, next.totalTokens),
  }
}

function correctionGuidance(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? '')
  if (/截斷|括號未閉合/.test(message)) return 'JSON 可能因輸出過長而被截斷；請縮短文字與表格列，只保留重要結果，並確保所有括號完整閉合。'
  if (/找不到|沒有 JSON 文字內容/.test(message)) return '回應中沒有可解析的 JSON object；請直接從 { 開始輸出。'
  if (/頂層/.test(message)) return 'JSON 頂層不是 object；請移除外層 array 或字串包裝。'
  if ((error as { name?: string })?.name === 'ZodError' || /Invalid input|expected|schema/i.test(message)) return 'JSON 欄位或型別不符合 schema；請依完整 schema 重新產生所有必要欄位。'
  return 'JSON 語法無法解析；請檢查引號、逗號與括號，並重新輸出完整 object。'
}

function retryPrompt(prompt: string, attempt: number, previousIssue: string) {
  if (attempt === 1) return prompt
  return `${prompt}\n\n【JSON 格式修正重做 ${attempt - 1}/${STRUCTURED_FORMAT_RETRIES}】\n上一個回應問題：${previousIssue}\n請重新完成整份分析；不要解釋錯誤，不要使用 Markdown 程式碼區塊，也不要在 JSON 前後加入任何文字。`
}

function isEmptyModelResponse(error: unknown) {
  return error instanceof Error && /模型已回應，但沒有 JSON 文字內容/.test(error.message)
}

export async function generateWithFormatRetries<T>(options: {
  stage: string
  prompt: string
  generate: (prompt: string, signal?: AbortSignal) => Promise<RawStructuredGeneration>
  parseAndValidate: (text: string) => T
  signal?: AbortSignal
  onRetry?: (notice: StructuredRetryNotice) => void
}) {
  let usage: AnalysisUsage = { inputTokens: null, outputTokens: null, totalTokens: null }
  let lastError: unknown
  let previousIssue = ''

  for (let attempt = 1; attempt <= STRUCTURED_FORMAT_ATTEMPTS; attempt += 1) {
    if (options.signal?.aborted) throw new DOMException('分析已取消。', 'AbortError')

    let raw: RawStructuredGeneration
    try {
      raw = await options.generate(retryPrompt(options.prompt, attempt, previousIssue), options.signal)
    } catch (error) {
      if (options.signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw error
      if (!isEmptyModelResponse(error)) throw error
      lastError = error
      previousIssue = correctionGuidance(error)
      if (attempt < STRUCTURED_FORMAT_ATTEMPTS) {
        options.onRetry?.({ stage: options.stage, retry: attempt, maxRetries: STRUCTURED_FORMAT_RETRIES })
        continue
      }
      break
    }

    usage = addUsage(usage, raw.usage)
    try {
      const result = options.parseAndValidate(raw.text)
      return { result, usage, rawText: raw.text, attempts: attempt }
    } catch (error) {
      lastError = error
      previousIssue = correctionGuidance(error)
      if (attempt < STRUCTURED_FORMAT_ATTEMPTS) {
        options.onRetry?.({ stage: options.stage, retry: attempt, maxRetries: STRUCTURED_FORMAT_RETRIES })
      }
    }
  }

  const detail = (lastError instanceof Error ? lastError.message : String(lastError ?? '')).replace(/\s+/g, ' ').slice(0, 160)
  throw new Error(`${options.stage}的初次 API 回應與 ${STRUCTURED_FORMAT_RETRIES} 次重做都不是可辨識且符合格式的 JSON。系統已保留原有分析；請重試或改用其他模型。${detail ? `（最後錯誤：${detail}）` : ''}`)
}
