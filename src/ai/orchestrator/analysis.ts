import type { ZodType } from 'zod'
import type { AnalysisResponse, Pass1Result, Pass2Result, PdfDocumentData, ProviderConfig, TableAnalysis } from '../../domain/types'
import { normalizePass2Response, PASS1_JSON_SCHEMA, PASS2_JSON_SCHEMA, PASS3_JSON_SCHEMA, TABLE_JSON_SCHEMA, parseJsonResponse, pass2Schema, pass3Schema, schemaValidationMessage, tableAnalysisSchema, validatePass1 } from '../../domain/schemas'
import { verifyEvidence } from '../../pdf/pdfClient'
import { generateStructured } from '../providers/provider'
import { pass1Prompt, pass2Prompt, pass3Prompt, tablePrompt } from '../prompts/prompts'

async function run<T>(config: ProviderConfig, document: PdfDocumentData, prompt: string, jsonSchema: object, validator: ZodType<T>, stage: string, signal?: AbortSignal) {
  const raw = await generateStructured(config, document, prompt, jsonSchema, signal)
  try {
    const parsed = validator.parse(parseJsonResponse(raw.text))
    return { result: parsed, usage: raw.usage, rawText: raw.text }
  } catch (error) {
    throw new Error(schemaValidationMessage(error, stage) ?? (error instanceof Error ? error.message : String(error)))
  }
}

export async function analyzePass1(config: ProviderConfig, document: PdfDocumentData, paperId: string, researchQuestion: string, signal?: AbortSignal): Promise<AnalysisResponse> {
  const raw = await generateStructured(config, document, pass1Prompt(researchQuestion), PASS1_JSON_SCHEMA, signal)
  let result: Pass1Result
  try {
    result = validatePass1(parseJsonResponse(raw.text), document.pageCount, paperId)
  } catch (error) {
    throw new Error(schemaValidationMessage(error, '第一遍閱讀') ?? (error instanceof Error ? error.message : String(error)))
  }
  result.evidence = verifyEvidence(result.evidence, document.pagesText)
  return { result, usage: raw.usage, rawText: raw.text }
}

export async function analyzePass2(config: ProviderConfig, document: PdfDocumentData, paperId: string, pass1: Pass1Result, signal?: AbortSignal) {
  const raw = await generateStructured(config, document, pass2Prompt(pass1), PASS2_JSON_SCHEMA, signal)
  let parsed: Pass2Result
  try {
    parsed = pass2Schema.parse(normalizePass2Response(parseJsonResponse(raw.text)))
  } catch (error) {
    throw new Error(schemaValidationMessage(error, '第二遍閱讀') ?? (error instanceof Error ? error.message : String(error)))
  }
  const response = { result: parsed, usage: raw.usage, rawText: raw.text }
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

export async function analyzePass3(config: ProviderConfig, document: PdfDocumentData, pass1: Pass1Result, pass2: Pass2Result, userPlan: string, signal?: AbortSignal) {
  return run(config, document, pass3Prompt(pass1, pass2, userPlan), PASS3_JSON_SCHEMA, pass3Schema, '第三遍閱讀', signal)
}

export async function analyzeTable(config: ProviderConfig, document: PdfDocumentData, paperId: string, label: string, pageIndex: number, signal?: AbortSignal) {
  const pageText = document.pagesText[pageIndex] ?? ''
  const response = await run(config, document, tablePrompt(label, pageIndex, pageText), TABLE_JSON_SCHEMA, tableAnalysisSchema, '表格分析', signal)
  const result: TableAnalysis = {
    ...response.result,
    id: crypto.randomUUID(), paperId, pdfPageIndex: pageIndex,
    observations: response.result.observations.map((item) => ({ ...item, paperId })),
    evidence: verifyEvidence(response.result.evidence.map((item) => ({ ...item, paperId })), document.pagesText),
    createdAt: new Date().toISOString(),
  }
  return { ...response, result }
}
