import type { ZodType } from 'zod'
import type { AnalysisResponse, Pass1Result, Pass2Result, PdfDocumentData, PdfHighlight, ProviderConfig, TableAnalysis, UserNote } from '../../domain/types'
import { normalizePass2Response, normalizeTableResponse, PASS1_JSON_SCHEMA, PASS2_JSON_SCHEMA, TABLE_JSON_SCHEMA, parseJsonResponse, pass2Schema, tableAnalysisSchema, validatePass1 } from '../../domain/schemas'
import { verifyEvidence } from '../../pdf/pdfClient'
import { generateStructured, generateText, structuredOutputContract } from '../providers/provider'
import { pass1Prompt, pass2Prompt, pass3Prompt, tablePrompt } from '../prompts/prompts'
import { generateWithFormatRetries } from './structuredRetry'
import type { StructuredRetryNotice } from './structuredRetry'
import { wrapUntrusted } from '../security'

export type FormatRetryHandler = (notice: StructuredRetryNotice) => void

async function run<T>(config: ProviderConfig, document: PdfDocumentData, prompt: string, jsonSchema: object, validator: ZodType<T>, stage: string, signal?: AbortSignal, normalize: (value: unknown) => unknown = (value) => value, onRetry?: FormatRetryHandler) {
  return generateWithFormatRetries({
    stage,
    prompt,
    signal,
    onRetry,
    generate: (attemptPrompt, attemptSignal) => generateStructured(config, document, attemptPrompt, jsonSchema, attemptSignal),
    repair: (rawText, issue, repairSignal) => repairStructured(config, rawText, issue, stage, jsonSchema, repairSignal),
    parseAndValidate: (text) => validator.parse(normalize(parseJsonResponse(text))),
  })
}

async function repairStructured(config: ProviderConfig, rawText: string, issue: string, stage: string, jsonSchema: object, signal?: AbortSignal) {
  const prompt = `你是 ${stage} 的 JSON 格式化器。上一個模型已完成內容分析，但輸出格式不符合要求。請只根據原始輸出重新整理，不要重新分析、補造事實或刪除內容；修復 JSON 語法、欄位名稱、型別與缺少的必要欄位。只回傳一個 JSON object，不要 Markdown 程式碼區塊、前言或解釋。\n格式問題：${issue}\n${structuredOutputContract(jsonSchema)}\n${wrapUntrusted('invalid-model-output', rawText)}`
  return generateText(config, prompt, signal, jsonSchema)
}

export async function analyzePass1(config: ProviderConfig, document: PdfDocumentData, paperId: string, researchQuestion: string, signal?: AbortSignal, onRetry?: FormatRetryHandler): Promise<AnalysisResponse> {
  const response = await generateWithFormatRetries({
    stage: '第一遍閱讀',
    prompt: pass1Prompt(researchQuestion),
    signal,
    onRetry,
    generate: (attemptPrompt, attemptSignal) => generateStructured(config, document, attemptPrompt, PASS1_JSON_SCHEMA, attemptSignal),
    repair: (rawText, issue, repairSignal) => repairStructured(config, rawText, issue, '第一遍閱讀', PASS1_JSON_SCHEMA, repairSignal),
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
    repair: (rawText, issue, repairSignal) => repairStructured(config, rawText, issue, '第二遍閱讀', PASS2_JSON_SCHEMA, repairSignal),
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

export async function analyzePass3(config: ProviderConfig, pass1: Pass1Result, pass2: Pass2Result, notes: UserNote[], highlights: PdfHighlight[], userPlan: string, signal?: AbortSignal) {
  const response = await generateText(config, pass3Prompt(pass1, pass2, userPlan, notes, highlights), signal)
  const text = response.text.trim()
  if (!text) throw new Error('第三遍沒有回傳可保存的文字。')
  return { text, usage: response.usage, rawText: response.text }
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
