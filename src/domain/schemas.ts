import { z } from 'zod'
import type { Pass1Result } from './types'

const nullableString = z.string().nullable()

export const sourceEvidenceSchema = z.object({
  id: z.string().min(1),
  paperId: z.string(),
  pdfPageIndex: z.number().int().nonnegative().nullable(),
  pdfPageDisplay: z.number().int().positive().nullable(),
  printedPage: nullableString,
  section: nullableString,
  objectType: z.enum(['text', 'table', 'figure', 'unknown']),
  objectLabel: nullableString,
  quote: nullableString,
  verificationStatus: z.enum(['matched', 'unverified', 'mismatch']),
  notes: nullableString,
})

const fiveCItemSchema = z.object({
  name: z.enum(['Category', 'Context', 'Correctness', 'Contributions', 'Clarity']),
  summary: z.string().min(1),
  evidenceIds: z.array(z.string()),
})

export const pass1Schema = z.object({
  schemaVersion: z.literal('1.0'),
  promptVersion: z.literal('pass1.v1'),
  title: nullableString,
  authors: z.array(z.string()),
  year: z.number().int().min(1500).max(2200).nullable(),
  doi: nullableString,
  oneSentenceTopic: z.string().min(1).max(120),
  researchQuestion: z.string().min(1),
  field: z.string().min(1),
  paperType: z.string().min(1),
  outline: z.array(z.string()),
  fiveCs: z.array(fiveCItemSchema).length(5),
  contributions: z.array(z.string()).max(3),
  readingDecision: z.object({
    recommendation: z.enum(['continue', 'later', 'stop']),
    reason: z.string().min(1),
  }),
  unclearConcepts: z.array(z.string()),
  evidence: z.array(sourceEvidenceSchema),
})

export const PASS1_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    schemaVersion: { type: 'string', enum: ['1.0'] },
    promptVersion: { type: 'string', enum: ['pass1.v1'] },
    title: { type: ['string', 'null'] },
    authors: { type: 'array', items: { type: 'string' } },
    year: { type: ['integer', 'null'] },
    doi: { type: ['string', 'null'] },
    oneSentenceTopic: { type: 'string', description: '繁體中文，一句話且不超過 60 個中文字。' },
    researchQuestion: { type: 'string' },
    field: { type: 'string' },
    paperType: { type: 'string' },
    outline: { type: 'array', items: { type: 'string' } },
    fiveCs: {
      type: 'array',
      minItems: 5,
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', enum: ['Category', 'Context', 'Correctness', 'Contributions', 'Clarity'] },
          summary: { type: 'string' },
          evidenceIds: { type: 'array', items: { type: 'string' } },
        },
        required: ['name', 'summary', 'evidenceIds'],
      },
    },
    contributions: { type: 'array', maxItems: 3, items: { type: 'string' } },
    readingDecision: {
      type: 'object',
      additionalProperties: false,
      properties: {
        recommendation: { type: 'string', enum: ['continue', 'later', 'stop'] },
        reason: { type: 'string' },
      },
      required: ['recommendation', 'reason'],
    },
    unclearConcepts: { type: 'array', items: { type: 'string' } },
    evidence: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          paperId: { type: 'string', description: 'Phase 0 可先輸出空字串，由應用程式綁定目前論文。' },
          pdfPageIndex: { type: ['integer', 'null'] },
          pdfPageDisplay: { type: ['integer', 'null'] },
          printedPage: { type: ['string', 'null'] },
          section: { type: ['string', 'null'] },
          objectType: { type: 'string', enum: ['text', 'table', 'figure', 'unknown'] },
          objectLabel: { type: ['string', 'null'] },
          quote: { type: ['string', 'null'] },
          verificationStatus: { type: 'string', enum: ['matched', 'unverified', 'mismatch'] },
          notes: { type: ['string', 'null'] },
        },
        required: ['id', 'paperId', 'pdfPageIndex', 'pdfPageDisplay', 'printedPage', 'section', 'objectType', 'objectLabel', 'quote', 'verificationStatus', 'notes'],
      },
    },
  },
  required: ['schemaVersion', 'promptVersion', 'title', 'authors', 'year', 'doi', 'oneSentenceTopic', 'researchQuestion', 'field', 'paperType', 'outline', 'fiveCs', 'contributions', 'readingDecision', 'unclearConcepts', 'evidence'],
} as const

type JsonRecord = Record<string, unknown>
const FIVE_C_NAMES = ['Category', 'Context', 'Correctness', 'Contributions', 'Clarity'] as const

function record(value: unknown): JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
}

function first(source: JsonRecord, keys: string[]) {
  for (const key of keys) if (source[key] !== undefined && source[key] !== null) return source[key]
  return undefined
}

function text(value: unknown, fallback = ''): string {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    const rows = value.map((item) => text(item)).filter(Boolean)
    if (rows.length) return rows.join('；')
  }
  return fallback
}

function nullableText(value: unknown) {
  const result = text(value)
  return result || null
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => text(item)).filter(Boolean)
  const single = text(value)
  return single ? single.split(/\n|;/).map((item) => item.trim()).filter(Boolean) : []
}

function yearValue(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number.parseInt(text(value), 10)
  return Number.isInteger(parsed) && parsed >= 1500 && parsed <= 2200 ? parsed : null
}

function integerValue(value: unknown) {
  if (typeof value === 'number' && Number.isInteger(value)) return value
  const parsed = Number.parseInt(text(value), 10)
  return Number.isInteger(parsed) ? parsed : null
}

function evidenceIds(value: unknown) {
  if (!Array.isArray(value)) return stringList(value)
  return value.flatMap((item) => {
    if (typeof item === 'string' || typeof item === 'number') return [String(item)]
    const id = text(first(record(item), ['id', 'evidenceId', 'sourceId']))
    return id ? [id] : []
  })
}

function normalizeEvidence(value: unknown) {
  const rows = Array.isArray(value) ? value : []
  return rows.map((item, index) => {
    const source = record(item)
    const explicitIndex = integerValue(first(source, ['pdfPageIndex', 'pageIndex']))
    const displayPage = integerValue(first(source, ['pdfPageDisplay', 'page', 'pageNumber']))
    const pageIndex = explicitIndex !== null ? explicitIndex : displayPage !== null && displayPage > 0 ? displayPage - 1 : null
    const pageDisplay = pageIndex !== null && pageIndex >= 0 ? pageIndex + 1 : null
    const objectLabel = nullableText(first(source, ['objectLabel', 'label', 'table', 'figure']))
    const rawType = text(first(source, ['objectType', 'type'])).toLowerCase()
    const objectType = rawType === 'text' || rawType === 'table' || rawType === 'figure' || rawType === 'unknown'
      ? rawType
      : objectLabel?.toLowerCase().startsWith('table') ? 'table'
        : objectLabel?.toLowerCase().startsWith('figure') ? 'figure' : 'text'
    const rawStatus = text(first(source, ['verificationStatus', 'status'])).toLowerCase()
    const verificationStatus = rawStatus === 'matched' || rawStatus === 'mismatch' || rawStatus === 'unverified' ? rawStatus : 'unverified'
    return {
      id: text(first(source, ['id', 'evidenceId', 'sourceId']), `evidence-${index + 1}`),
      paperId: text(source.paperId),
      pdfPageIndex: pageIndex !== null && pageIndex >= 0 ? pageIndex : null,
      pdfPageDisplay: pageDisplay,
      printedPage: nullableText(first(source, ['printedPage', 'printed_page'])),
      section: nullableText(first(source, ['section', 'sectionName', 'heading'])),
      objectType,
      objectLabel,
      quote: nullableText(first(source, ['quote', 'excerpt', 'text', 'sourceText'])),
      verificationStatus,
      notes: nullableText(first(source, ['notes', 'note', 'comment'])),
    }
  })
}

function fiveCSource(source: JsonRecord, name: typeof FIVE_C_NAMES[number]) {
  const collection = first(source, ['fiveCs', 'fiveC', 'five_c'])
  if (Array.isArray(collection)) {
    return record(collection.find((item) => text(first(record(item), ['name', 'category', 'key'])).toLowerCase() === name.toLowerCase()))
  }
  const object = record(collection)
  const match = Object.entries(object).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1]
  if (match !== undefined) return typeof match === 'string' ? { summary: match } : record(match)
  const direct = Object.entries(source).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1]
  return typeof direct === 'string' ? { summary: direct } : record(direct)
}

function readingDecision(source: JsonRecord) {
  const raw = first(source, ['readingDecision', 'decision', 'recommendation'])
  const object = record(raw)
  const label = text(first(object, ['recommendation', 'decision', 'value']), text(raw)).toLowerCase()
  const recommendation = label.includes('continue') || label.includes('繼續')
    ? 'continue' : label.includes('stop') || label.includes('停止') || label.includes('不讀')
      ? 'stop' : 'later'
  return {
    recommendation,
    reason: text(first(object, ['reason', 'explanation', 'rationale']), text(first(source, ['readingReason', 'decisionReason']), 'AI 未提供明確的閱讀建議理由。')),
  }
}

/**
 * Providers do not all enforce JSON Schema equally. Normalize common compact
 * or wrapped responses before strict validation without inventing paper facts.
 */
export function normalizePass1Response(value: unknown): unknown {
  const outer = record(value)
  const wrapped = first(outer, ['result', 'pass1', 'analysis', 'data'])
  const source = Object.keys(record(wrapped)).length ? record(wrapped) : outer
  const metadata = record(first(source, ['metadata', 'paperMetadata', 'paper']))
  const evidence = normalizeEvidence(first(source, ['evidence', 'sourceRefs', 'sources', 'citations']))
  const fiveCs = FIVE_C_NAMES.map((name) => {
    const item = fiveCSource(source, name)
    return {
      name,
      summary: text(first(item, ['summary', 'description', 'assessment', 'text', 'value']), '未找到'),
      evidenceIds: evidenceIds(first(item, ['evidenceIds', 'evidence', 'sourceRefs', 'sources'])),
    }
  })
  const contributions = stringList(first(source, ['contributions', 'mainContributions', 'innovations', 'keyInnovations'])).slice(0, 3)
  return {
    schemaVersion: '1.0',
    promptVersion: 'pass1.v1',
    title: nullableText(first(source, ['title', 'paperTitle'])) ?? nullableText(first(metadata, ['title', 'paperTitle'])),
    authors: stringList(first(source, ['authors', 'author'])) .concat(stringList(first(metadata, ['authors', 'author']))).filter((item, index, rows) => rows.indexOf(item) === index),
    year: yearValue(first(source, ['year', 'publicationYear']) ?? first(metadata, ['year', 'publicationYear'])),
    doi: nullableText(first(source, ['doi', 'DOI'])) ?? nullableText(first(metadata, ['doi', 'DOI'])),
    oneSentenceTopic: text(first(source, ['oneSentenceTopic', 'topic', 'oneSentenceSummary', 'summary']), '未找到研究主題').slice(0, 120),
    researchQuestion: text(first(source, ['researchQuestion', 'researchQuestions', 'question', 'problem']), '未找到研究問題'),
    field: text(first(source, ['field', 'domain', 'researchField']), '未判定領域'),
    paperType: text(first(source, ['paperType', 'type', 'category']), '未判定類型'),
    outline: stringList(first(source, ['outline', 'sections', 'structure', 'paperOutline'])),
    fiveCs,
    contributions,
    readingDecision: readingDecision(source),
    unclearConcepts: stringList(first(source, ['unclearConcepts', 'conceptsToClarify', 'keyConcepts', 'openQuestions'])),
    evidence,
  }
}

export function validatePass1(value: unknown, pageCount: number, paperId: string): Pass1Result {
  const parsed = pass1Schema.parse(normalizePass1Response(value))
  const evidence = parsed.evidence.map((item) => {
    const pageValid = item.pdfPageIndex === null || item.pdfPageIndex < pageCount
    const displayMatches = item.pdfPageIndex === null
      ? item.pdfPageDisplay === null
      : item.pdfPageDisplay === item.pdfPageIndex + 1
    return {
      ...item,
      paperId,
      verificationStatus: pageValid && displayMatches ? item.verificationStatus : 'mismatch' as const,
      notes: pageValid && displayMatches ? item.notes : '頁碼超出 PDF 範圍，或 0-based／1-based 頁碼不一致。',
    }
  })
  return { ...parsed, evidence }
}

export function parseJsonResponse(raw: string): unknown {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
  const first = cleaned.indexOf('{')
  const last = cleaned.lastIndexOf('}')
  if (first < 0 || last <= first) throw new Error('API 回應不是可辨識的 JSON。')
  return JSON.parse(cleaned.slice(first, last + 1))
}

export function schemaValidationMessage(error: unknown, stage: string) {
  if (!(error instanceof z.ZodError)) return null
  const fields = [...new Set(error.issues.map((issue) => issue.path.length ? issue.path.join('.') : 'root'))].slice(0, 6)
  const suffix = error.issues.length > fields.length ? `等 ${error.issues.length} 個欄位` : fields.join('、')
  return `${stage}的 AI 回傳格式不完整（${suffix}）。系統未覆蓋原有分析；請重試，或改用較擅長結構化輸出的模型。`
}

const informationStatusSchema = z.enum(['reported', 'inferred', 'not_reported', 'unknown'])
const evidenceIdsSchema = z.array(z.string())

export const metricObservationSchema = z.object({
  id: z.string(),
  paperId: z.string(),
  methodName: z.string(),
  methodOrigin: z.enum(['paper_proposed', 'reproduced_baseline', 'cited_prior_work']),
  task: z.string(),
  dataset: nullableString,
  datasetVersion: nullableString,
  split: nullableString,
  metricName: z.string(),
  metricDefinition: nullableString,
  direction: z.enum(['higher', 'lower', 'unknown']),
  rawValue: z.string(),
  numericValue: z.number().nullable(),
  unit: nullableString,
  dispersion: nullableString,
  pretrainedData: nullableString,
  hardware: nullableString,
  protocol: nullableString,
  status: informationStatusSchema,
  evidenceIds: evidenceIdsSchema,
})

const citationSchema = z.object({
  id: z.string(), raw: z.string(), title: nullableString, authors: z.array(z.string()),
  year: z.number().int().nullable(), doi: nullableString,
  verification: z.enum(['paper_only', 'externally_verified', 'unverified']),
})

export const pass2Schema = z.object({
  schemaVersion: z.literal('1.0'), promptVersion: z.literal('pass2.v1'),
  motivation: z.string(), problemDefinition: z.string(), inputOutput: z.string(),
  methodSteps: z.array(z.string()), modules: z.array(z.string()),
  trainingSetup: nullableString, inferenceSetup: nullableString,
  datasets: z.array(z.object({
    name: z.string(), version: nullableString, size: nullableString, split: nullableString,
    externalValidation: nullableString, leakageRisk: nullableString, status: informationStatusSchema,
    evidenceIds: evidenceIdsSchema,
  })),
  metrics: z.array(z.object({
    name: z.string(), definition: nullableString, direction: z.enum(['higher', 'lower', 'unknown']),
    unit: nullableString, evidenceIds: evidenceIdsSchema,
  })),
  figures: z.array(z.object({ label: z.string(), title: z.string(), pdfPageIndex: z.number().int().nullable(), purpose: z.string(), interpretation: z.string(), checkItems: z.array(z.string()) })),
  tables: z.array(z.object({ label: z.string(), title: z.string(), pdfPageIndex: z.number().int().nullable(), purpose: z.string(), interpretation: z.string(), checkItems: z.array(z.string()) })),
  claims: z.array(z.object({ claim: z.string(), support: z.string(), limitation: z.string(), evidenceIds: evidenceIdsSchema })),
  guideQuestions: z.array(z.string()).min(3).max(5),
  observations: z.array(metricObservationSchema),
  references: z.array(citationSchema),
  evidence: z.array(sourceEvidenceSchema),
})

export const pass3Schema = z.object({
  schemaVersion: z.literal('1.0'), promptVersion: z.literal('pass3.v1'),
  reconstruction: z.array(z.object({ step: z.string(), detail: z.string(), status: z.enum(['explicit', 'implicit', 'missing']), evidenceIds: evidenceIdsSchema })),
  assumptions: z.array(z.object({ title: z.string(), assessment: z.string(), status: z.enum(['confirmed', 'needs_verification', 'indeterminate']), evidenceIds: evidenceIdsSchema })),
  threats: z.array(z.object({ title: z.string(), assessment: z.string(), status: z.enum(['confirmed', 'needs_verification', 'indeterminate']), evidenceIds: evidenceIdsSchema })),
  reproducibilityRisks: z.array(z.object({ title: z.string(), assessment: z.string(), status: z.enum(['confirmed', 'needs_verification', 'indeterminate']), evidenceIds: evidenceIdsSchema })),
  researchIdeas: z.array(z.object({ question: z.string(), motivation: z.string(), hypothesis: z.string(), minimumExperiment: z.string(), requiredData: z.string(), metric: z.string() })).min(3).max(5),
})

export const tableAnalysisSchema = z.object({
  label: z.string(), title: z.string(), pdfPageIndex: z.number().int().nonnegative(),
  columns: z.array(z.string()),
  rows: z.array(z.array(z.object({ raw: z.string(), emphasized: z.boolean() }))),
  footnotes: z.array(z.string()), observations: z.array(metricObservationSchema),
  positioning: z.array(z.string()), tradeoffs: z.array(z.string()), limitations: z.array(z.string()),
  evidence: z.array(sourceEvidenceSchema),
})

const nullableStringJson = { type: ['string', 'null'] } as const
const evidenceIdsJson = { type: 'array', items: { type: 'string' } } as const
const metricObservationJson = {
  type: 'object', additionalProperties: false,
  properties: {
    id: { type: 'string' }, paperId: { type: 'string' }, methodName: { type: 'string' },
    methodOrigin: { type: 'string', enum: ['paper_proposed', 'reproduced_baseline', 'cited_prior_work'] },
    task: { type: 'string' }, dataset: nullableStringJson, datasetVersion: nullableStringJson, split: nullableStringJson,
    metricName: { type: 'string' }, metricDefinition: nullableStringJson,
    direction: { type: 'string', enum: ['higher', 'lower', 'unknown'] }, rawValue: { type: 'string' },
    numericValue: { type: ['number', 'null'] }, unit: nullableStringJson, dispersion: nullableStringJson,
    pretrainedData: nullableStringJson, hardware: nullableStringJson, protocol: nullableStringJson,
    status: { type: 'string', enum: ['reported', 'inferred', 'not_reported', 'unknown'] }, evidenceIds: evidenceIdsJson,
  },
  required: ['id', 'paperId', 'methodName', 'methodOrigin', 'task', 'dataset', 'datasetVersion', 'split', 'metricName', 'metricDefinition', 'direction', 'rawValue', 'numericValue', 'unit', 'dispersion', 'pretrainedData', 'hardware', 'protocol', 'status', 'evidenceIds'],
} as const

const indexJson = {
  type: 'object', additionalProperties: false,
  properties: { label: { type: 'string' }, title: { type: 'string' }, pdfPageIndex: { type: ['integer', 'null'] }, purpose: { type: 'string' }, interpretation: { type: 'string' }, checkItems: { type: 'array', items: { type: 'string' } } },
  required: ['label', 'title', 'pdfPageIndex', 'purpose', 'interpretation', 'checkItems'],
} as const

export const PASS2_JSON_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    schemaVersion: { type: 'string', enum: ['1.0'] }, promptVersion: { type: 'string', enum: ['pass2.v1'] },
    motivation: { type: 'string' }, problemDefinition: { type: 'string' }, inputOutput: { type: 'string' },
    methodSteps: { type: 'array', items: { type: 'string' } }, modules: { type: 'array', items: { type: 'string' } },
    trainingSetup: nullableStringJson, inferenceSetup: nullableStringJson,
    datasets: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { name: { type: 'string' }, version: nullableStringJson, size: nullableStringJson, split: nullableStringJson, externalValidation: nullableStringJson, leakageRisk: nullableStringJson, status: { type: 'string', enum: ['reported', 'inferred', 'not_reported', 'unknown'] }, evidenceIds: evidenceIdsJson }, required: ['name', 'version', 'size', 'split', 'externalValidation', 'leakageRisk', 'status', 'evidenceIds'] } },
    metrics: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { name: { type: 'string' }, definition: nullableStringJson, direction: { type: 'string', enum: ['higher', 'lower', 'unknown'] }, unit: nullableStringJson, evidenceIds: evidenceIdsJson }, required: ['name', 'definition', 'direction', 'unit', 'evidenceIds'] } },
    figures: { type: 'array', items: indexJson }, tables: { type: 'array', items: indexJson },
    claims: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { claim: { type: 'string' }, support: { type: 'string' }, limitation: { type: 'string' }, evidenceIds: evidenceIdsJson }, required: ['claim', 'support', 'limitation', 'evidenceIds'] } },
    guideQuestions: { type: 'array', minItems: 3, maxItems: 5, items: { type: 'string' } },
    observations: { type: 'array', items: metricObservationJson },
    references: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string' }, raw: { type: 'string' }, title: nullableStringJson, authors: { type: 'array', items: { type: 'string' } }, year: { type: ['integer', 'null'] }, doi: nullableStringJson, verification: { type: 'string', enum: ['paper_only', 'externally_verified', 'unverified'] } }, required: ['id', 'raw', 'title', 'authors', 'year', 'doi', 'verification'] } },
    evidence: { type: 'array', items: PASS1_JSON_SCHEMA.properties.evidence.items },
  },
  required: ['schemaVersion', 'promptVersion', 'motivation', 'problemDefinition', 'inputOutput', 'methodSteps', 'modules', 'trainingSetup', 'inferenceSetup', 'datasets', 'metrics', 'figures', 'tables', 'claims', 'guideQuestions', 'observations', 'references', 'evidence'],
} as const

const criticalJson = { type: 'object', additionalProperties: false, properties: { title: { type: 'string' }, assessment: { type: 'string' }, status: { type: 'string', enum: ['confirmed', 'needs_verification', 'indeterminate'] }, evidenceIds: evidenceIdsJson }, required: ['title', 'assessment', 'status', 'evidenceIds'] } as const
export const PASS3_JSON_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    schemaVersion: { type: 'string', enum: ['1.0'] }, promptVersion: { type: 'string', enum: ['pass3.v1'] },
    reconstruction: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { step: { type: 'string' }, detail: { type: 'string' }, status: { type: 'string', enum: ['explicit', 'implicit', 'missing'] }, evidenceIds: evidenceIdsJson }, required: ['step', 'detail', 'status', 'evidenceIds'] } },
    assumptions: { type: 'array', items: criticalJson }, threats: { type: 'array', items: criticalJson }, reproducibilityRisks: { type: 'array', items: criticalJson },
    researchIdeas: { type: 'array', minItems: 3, maxItems: 5, items: { type: 'object', additionalProperties: false, properties: { question: { type: 'string' }, motivation: { type: 'string' }, hypothesis: { type: 'string' }, minimumExperiment: { type: 'string' }, requiredData: { type: 'string' }, metric: { type: 'string' } }, required: ['question', 'motivation', 'hypothesis', 'minimumExperiment', 'requiredData', 'metric'] } },
  },
  required: ['schemaVersion', 'promptVersion', 'reconstruction', 'assumptions', 'threats', 'reproducibilityRisks', 'researchIdeas'],
} as const

export const TABLE_JSON_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    label: { type: 'string' }, title: { type: 'string' }, pdfPageIndex: { type: 'integer' },
    columns: { type: 'array', items: { type: 'string' } }, rows: { type: 'array', items: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { raw: { type: 'string' }, emphasized: { type: 'boolean' } }, required: ['raw', 'emphasized'] } } },
    footnotes: { type: 'array', items: { type: 'string' } }, observations: { type: 'array', items: metricObservationJson },
    positioning: { type: 'array', items: { type: 'string' } }, tradeoffs: { type: 'array', items: { type: 'string' } }, limitations: { type: 'array', items: { type: 'string' } },
    evidence: { type: 'array', items: PASS1_JSON_SCHEMA.properties.evidence.items },
  },
  required: ['label', 'title', 'pdfPageIndex', 'columns', 'rows', 'footnotes', 'observations', 'positioning', 'tradeoffs', 'limitations', 'evidence'],
} as const
