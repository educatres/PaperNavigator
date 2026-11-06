import type { AnalysisUsage } from '../../domain/types'

export const STRUCTURED_FORMAT_ATTEMPTS = 3

export interface StructuredRetryNotice {
  stage: string
  attempt: number
  maxAttempts: number
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

function retryPrompt(prompt: string, attempt: number) {
  if (attempt === 1) return prompt
  return `${prompt}\n\n【JSON 格式修正重做 ${attempt}/${STRUCTURED_FORMAT_ATTEMPTS}】\n上一個回應不是可解析且符合指定 schema 的單一 JSON 物件。請重新完成整份分析；不要解釋錯誤，不要使用 Markdown 程式碼區塊，也不要在 JSON 前後加入任何文字。`
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

  for (let attempt = 1; attempt <= STRUCTURED_FORMAT_ATTEMPTS; attempt += 1) {
    if (options.signal?.aborted) throw new DOMException('分析已取消。', 'AbortError')

    let raw: RawStructuredGeneration
    try {
      raw = await options.generate(retryPrompt(options.prompt, attempt), options.signal)
    } catch (error) {
      if (options.signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw error
      if (!isEmptyModelResponse(error)) throw error
      lastError = error
      if (attempt < STRUCTURED_FORMAT_ATTEMPTS) {
        options.onRetry?.({ stage: options.stage, attempt: attempt + 1, maxAttempts: STRUCTURED_FORMAT_ATTEMPTS })
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
      if (attempt < STRUCTURED_FORMAT_ATTEMPTS) {
        options.onRetry?.({ stage: options.stage, attempt: attempt + 1, maxAttempts: STRUCTURED_FORMAT_ATTEMPTS })
      }
    }
  }

  const detail = (lastError instanceof Error ? lastError.message : String(lastError ?? '')).replace(/\s+/g, ' ').slice(0, 160)
  throw new Error(`${options.stage}的 API 回應連續 ${STRUCTURED_FORMAT_ATTEMPTS} 次不是可辨識且符合格式的 JSON。系統已保留原有分析；請重試或改用其他模型。${detail ? `（最後錯誤：${detail}）` : ''}`)
}
