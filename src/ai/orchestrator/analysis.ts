import type { ZodType } from 'zod'
import type { AnalysisResponse, Pass1Result, Pass2Result, PdfDocumentData, ProviderConfig, TableAnalysis } from '../../domain/types'
import { normalizePass2Response, normalizePass3Response, normalizeTableResponse, PASS1_JSON_SCHEMA, PASS2_JSON_SCHEMA, PASS3_JSON_SCHEMA, TABLE_JSON_SCHEMA, parseJsonResponse, pass2Schema, pass3Schema, tableAnalysisSchema, validatePass1 } from '../../domain/schemas'
import { verifyEvidence } from '../../pdf/pdfClient'
import { generateStructured } from '../providers/provider'
import { pass1Prompt, pass2Prompt, pass3Prompt, tablePrompt } from '../prompts/prompts'
import { generateWithFormatRetries } from './structuredRetry'
import type { StructuredRetryNotice } from './structuredRetry'

export type FormatRetryHandler = (notice: StructuredRetryNotice) => void

async function run<T>(config: ProviderConfig, document: PdfDocumentData, prompt: string, jsonSchema: object, validator: ZodType<T>, stage: string, signal?: AbortSignal, normalize: (value: unknown) => unknown = (value) => value, onRetry?: FormatRetryHandler) {
  return generateWithFormatRetries({
    stage,
    prompt,
    signal,
    onRetry,
    generate: (attemptPrompt, attemptSignal) => generateStructured(config, document, attemptPrompt, jsonSchema, attemptSignal),
    parseAndValidate: (text) => validator.parse(normalize(parseJsonResponse(text))),
  })
}

export async function analyzePass1(config: ProviderConfig, document: PdfDocumentData, paperId: string, researchQuestion: string, signal?: AbortSignal, onRetry?: FormatRetryHandler): Promise<AnalysisResponse> {
  const response = await generateWithFormatRetries({
    stage: '第一遍閱讀',
    prompt: pass1Prompt(researchQuestion),
    signal,
    onRetry,
    generate: (attemptPrompt, attemptSignal) => generateStructured(config, document, attemptPrompt, PASS1_JSON_SCHEMA, attemptSignal),
    parseAndValidate: (text) => validatePass1(parseJsonResponse(text), document.pageCount, paperId),
  })
  const result: Pass1Result = response.result
  result.evidence = verifyEvidence(result.evidence, document.pagesText)
  return { result, usage: response.usage, rawText: response.rawText }
}

export async function analyzePass2(config: ProviderConfig, document: PdfDocumentData, paperId: string, pass1: Pass1Result, signal?: AbortSignal, onRetry?: FormatRetryHandler) {
  const response = await generateWithFormatRetries({
    stage: '第二遍閱讀',
    prompt: pass2Prompt(pass1),
    signal,
    onRetry,
    generate: (attemptPrompt, attemptSignal) => generateStructured(config, document, attemptPrompt, PASS2_JSON_SCHEMA, attemptSignal),
    parseAndValidate: (text) => pass2Schema.parse(normalizePass2Response(parseJsonResponse(text))),
  })
  const validIndex = (value: number | null) => value !== null && value >= 0 && value < document.pageCount
  const result: Pass2Result = {
    ...response.result,
    figures: response.result.figures.map((item) => validIndex(item.pdfPageIndex) ? item : { ...item, pdfPageIndex: null, checkItems: [...item.checkItems, 'AI 回傳頁碼超出 PDF 範圍，需人工定位。'] }),
    tables: response.result.tables.map((item) => validIndex(item.pdfPageIndex) ? item : { ...item, pdfPageIndex: null, checkItems: [...item.checkItems, 'AI 回傳頁碼超出 PDF 範圍，需人工定位。'] }),
    observations: response.result.observations.map((item) => ({ ...item, paperId })),
    references: response.result.references.map((item) => ({ ...item, verification: item.verification === 'externally_verified' ? 'unverified' : item.verification })),
    evidence: verifyEvidence(response.result.evidence.map((item) => ({ ...item, paperId })), document.pagesText),
  }
  return { ...response, result }
}

export async function analyzePass3(config: ProviderConfig, document: PdfDocumentData, pass1: Pass1Result, pass2: Pass2Result, userPlan: string, signal?: AbortSignal, onRetry?: FormatRetryHandler) {
  return run(config, document, pass3Prompt(pass1, pass2, userPlan), PASS3_JSON_SCHEMA, pass3Schema, '第三遍閱讀', signal, normalizePass3Response, onRetry)
}

export async function analyzeTable(config: ProviderConfig, document: PdfDocumentData, paperId: string, label: string, pageIndex: number, signal?: AbortSignal, onRetry?: FormatRetryHandler) {
  const pageText = document.pagesText[pageIndex] ?? ''
  const response = await run(config, document, tablePrompt(label, pageIndex, pageText), TABLE_JSON_SCHEMA, tableAnalysisSchema, '表格分析', signal, normalizeTableResponse, onRetry)
  const result: TableAnalysis = {
    ...response.result,
    id: crypto.randomUUID(), paperId, label, pdfPageIndex: pageIndex,
    observations: response.result.observations.map((item) => ({ ...item, paperId })),
    evidence: verifyEvidence(response.result.evidence.map((item) => ({ ...item, paperId })), document.pagesText),
    createdAt: new Date().toISOString(),
  }
  return { ...response, result }
}
