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

function rows(value: unknown) {
  if (Array.isArray(value)) return value
  return value === undefined || value === null ? [] : [value]
}

function statusValue(value: unknown) {
  const raw = text(value).toLowerCase()
  return raw === 'reported' || raw === 'inferred' || raw === 'not_reported' || raw === 'unknown' ? raw : 'unknown'
}

function directionValue(value: unknown) {
  const raw = text(value).toLowerCase()
  return raw === 'higher' || raw === 'lower' ? raw : 'unknown'
}

function numericValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const parsed = Number.parseFloat(text(value).replace(/,/g, ''))
  return Number.isFinite(parsed) ? parsed : null
}

function booleanValue(value: unknown) {
  if (typeof value === 'boolean') return value
  const raw = text(value).toLowerCase()
  return raw === 'true' || raw === 'yes' || raw === '1' || raw === 'bold' || raw === 'emphasized'
}

function normalizeMetricObservation(value: unknown, index: number) {
  const row = record(value)
  const origin = text(first(row, ['methodOrigin', 'origin'])).toLowerCase()
  const methodOrigin = origin.includes('baseline') ? 'reproduced_baseline'
    : origin.includes('prior') || origin.includes('cited') ? 'cited_prior_work' : 'paper_proposed'
  return {
    id: text(first(row, ['id', 'observationId']), `observation-${index + 1}`),
    paperId: text(row.paperId),
    methodName: text(first(row, ['methodName', 'method', 'model']), '未命名方法'),
    methodOrigin,
    task: text(first(row, ['task', 'problem']), '未報告任務'),
    dataset: nullableText(first(row, ['dataset', 'datasetName'])),
    datasetVersion: nullableText(first(row, ['datasetVersion', 'version'])),
    split: nullableText(first(row, ['split', 'partition'])),
    metricName: text(first(row, ['metricName', 'metric']), '未命名指標'),
    metricDefinition: nullableText(first(row, ['metricDefinition', 'definition'])),
    direction: directionValue(first(row, ['direction', 'betterWhen'])),
    rawValue: text(first(row, ['rawValue', 'value', 'result']), '未報告'),
    numericValue: numericValue(first(row, ['numericValue', 'valueNumber'])),
    unit: nullableText(first(row, ['unit', 'units'])),
    dispersion: nullableText(first(row, ['dispersion', 'variance', 'std'])),
    pretrainedData: nullableText(first(row, ['pretrainedData', 'pretrainingData'])),
    hardware: nullableText(first(row, ['hardware', 'compute'])),
    protocol: nullableText(first(row, ['protocol', 'evaluationProtocol'])),
    status: statusValue(first(row, ['status', 'informationStatus'])),
    evidenceIds: evidenceIds(first(row, ['evidenceIds', 'evidence', 'sources'])),
  }
}

/**
 * Pass 2 contains many nested fields and some providers omit null/empty values.
 * Fill structural defaults and common aliases while keeping unknown paper facts
 * explicit, so a useful partial analysis is not discarded for missing metadata.
 */
export function normalizePass2Response(value: unknown): unknown {
  const outer = record(value)
  const wrapped = first(outer, ['result', 'pass2', 'analysis', 'data'])
  const source = Object.keys(record(wrapped)).length ? record(wrapped) : outer
  const list = (keys: string[]) => rows(first(source, keys))

  const datasets = list(['datasets', 'dataSets', 'data']).map((item) => {
    const row = record(item)
    return {
      name: text(first(row, ['name', 'dataset', 'title']), '未命名資料集'),
      version: nullableText(first(row, ['version', 'datasetVersion'])),
      size: nullableText(first(row, ['size', 'scale', 'samples'])),
      split: nullableText(first(row, ['split', 'partition'])),
      externalValidation: nullableText(first(row, ['externalValidation', 'external_validation', 'validation'])),
      leakageRisk: nullableText(first(row, ['leakageRisk', 'leakage_risk', 'leakage'])),
      status: statusValue(first(row, ['status', 'informationStatus'])),
      evidenceIds: evidenceIds(first(row, ['evidenceIds', 'evidence', 'sources'])),
    }
  })

  const metrics = list(['metrics', 'evaluationMetrics']).map((item) => {
    const row = record(item)
    return {
      name: text(first(row, ['name', 'metric', 'metricName']), '未命名指標'),
      definition: nullableText(first(row, ['definition', 'description', 'metricDefinition'])),
      direction: directionValue(first(row, ['direction', 'betterWhen'])),
      unit: nullableText(first(row, ['unit', 'units'])),
      evidenceIds: evidenceIds(first(row, ['evidenceIds', 'evidence', 'sources'])),
    }
  })

  const indexItems = (keys: string[], fallback: string) => list(keys).map((item, index) => {
    const row = record(item)
    return {
      label: text(first(row, ['label', 'id', 'name']), `${fallback} ${index + 1}`),
      title: text(first(row, ['title', 'caption', 'name']), '未提供標題'),
      pdfPageIndex: integerValue(first(row, ['pdfPageIndex', 'pageIndex'])) ?? (() => {
        const display = integerValue(first(row, ['page', 'pageNumber', 'pdfPageDisplay']))
        return display !== null && display > 0 ? display - 1 : null
      })(),
      purpose: text(first(row, ['purpose', 'role']), '未提供用途'),
      interpretation: text(first(row, ['interpretation', 'summary', 'finding']), '待人工解讀'),
      checkItems: stringList(first(row, ['checkItems', 'checks', 'cautions'])),
    }
  })

  const claims = list(['claims', 'claimEvidence']).map((item) => {
    const row = record(item)
    return {
      claim: text(first(row, ['claim', 'statement']), '未提供主張'),
      support: text(first(row, ['support', 'evidence', 'result']), '未找到支持證據'),
      limitation: text(first(row, ['limitation', 'limits', 'caveat']), '未報告限制'),
      evidenceIds: evidenceIds(first(row, ['evidenceIds', 'sources', 'sourceIds'])),
    }
  })

  const observations = list(['observations', 'results', 'metricObservations']).map(normalizeMetricObservation)

  const references = list(['references', 'citations', 'bibliography']).map((item, index) => {
    const row = record(item)
    const verification = text(first(row, ['verification', 'status'])).toLowerCase()
    return {
      id: text(first(row, ['id', 'citationId']), `reference-${index + 1}`),
      raw: text(first(row, ['raw', 'citation', 'reference', 'text']), '未提供完整引用'),
      title: nullableText(first(row, ['title', 'paperTitle'])),
      authors: stringList(first(row, ['authors', 'author'])),
      year: yearValue(row.year),
      doi: nullableText(first(row, ['doi', 'DOI'])),
      verification: verification === 'externally_verified' || verification === 'unverified' ? verification : 'paper_only',
    }
  })

  return {
    schemaVersion: '1.0',
    promptVersion: 'pass2.v1',
    motivation: text(first(source, ['motivation', 'researchMotivation']), '未找到研究動機'),
    problemDefinition: text(first(source, ['problemDefinition', 'problem', 'researchProblem']), '未找到問題定義'),
    inputOutput: text(first(source, ['inputOutput', 'inputsAndOutputs', 'io']), '未找到輸入與輸出說明'),
    methodSteps: stringList(first(source, ['methodSteps', 'steps', 'method'])),
    modules: stringList(first(source, ['modules', 'components'])),
    trainingSetup: nullableText(first(source, ['trainingSetup', 'training'])),
    inferenceSetup: nullableText(first(source, ['inferenceSetup', 'inference'])),
    datasets,
    metrics,
    figures: indexItems(['figures', 'figureIndex'], 'Figure'),
    tables: indexItems(['tables', 'tableIndex'], 'Table'),
    claims,
    guideQuestions: stringList(first(source, ['guideQuestions', 'questions', 'readingQuestions'])).slice(0, 5),
    observations,
    references,
    evidence: normalizeEvidence(first(source, ['evidence', 'sources', 'sourceRefs'])),
  }
}

/**
 * Keep the third reading usable when a provider returns only some sections or
 * uses compact field names. Missing sections stay empty instead of failing the
 * entire analysis and blocking later work.
 */
export function normalizePass3Response(value: unknown): unknown {
  const outer = record(value)
  const wrapped = first(outer, ['result', 'pass3', 'analysis', 'data'])
  const source = Object.keys(record(wrapped)).length ? record(wrapped) : outer
  const list = (keys: string[]) => rows(first(source, keys))

  const reconstruction = list(['reconstruction', 'methodReconstruction', 'steps']).map((item, index) => {
    const row = record(item)
    const rawStatus = text(first(row, ['status', 'certainty'])).toLowerCase()
    const status = rawStatus === 'explicit' || rawStatus === 'implicit' || rawStatus === 'missing' ? rawStatus : 'missing'
    return {
      step: text(first(row, ['step', 'name', 'title']), text(item, `步驟 ${index + 1}`)),
      detail: text(first(row, ['detail', 'description', 'assessment']), text(item, '未報告')),
      status,
      evidenceIds: evidenceIds(first(row, ['evidenceIds', 'evidence', 'sources'])),
    }
  })

  const criticalItems = (keys: string[]) => list(keys).map((item) => {
    const row = record(item)
    const rawStatus = text(first(row, ['status', 'certainty'])).toLowerCase()
    const status = rawStatus === 'confirmed' || rawStatus === 'needs_verification' || rawStatus === 'indeterminate'
      ? rawStatus : 'indeterminate'
    return {
      title: text(first(row, ['title', 'name', 'issue']), text(item, '未報告')),
      assessment: text(first(row, ['assessment', 'description', 'detail']), text(item, '未報告')),
      status,
      evidenceIds: evidenceIds(first(row, ['evidenceIds', 'evidence', 'sources'])),
    }
  })

  const researchIdeas = list(['researchIdeas', 'ideas', 'futureWork']).slice(0, 5).map((item) => {
    const row = record(item)
    return {
      question: text(first(row, ['question', 'researchQuestion', 'title']), text(item, '未報告')),
      motivation: text(first(row, ['motivation', 'rationale']), '未報告'),
      hypothesis: text(first(row, ['hypothesis', 'expectedResult']), '未報告'),
      minimumExperiment: text(first(row, ['minimumExperiment', 'experiment', 'method']), '未報告'),
      requiredData: text(first(row, ['requiredData', 'data', 'dataset']), '未報告'),
      metric: text(first(row, ['metric', 'evaluationMetric']), '未報告'),
    }
  })

  return {
    schemaVersion: '1.0',
    promptVersion: 'pass3.v1',
    reconstruction,
    assumptions: criticalItems(['assumptions', 'keyAssumptions']),
    threats: criticalItems(['threats', 'validityThreats', 'risks']),
    reproducibilityRisks: criticalItems(['reproducibilityRisks', 'reproducibility', 'replicationRisks']),
    researchIdeas,
  }
}

/**
 * Table extraction is intentionally best-effort. Providers often omit empty
 * arrays, return primitive cells, or provide only observations. Normalize all
 * of those shapes so one missing field never discards the useful remainder.
 */
export function normalizeTableResponse(value: unknown): unknown {
  const outer = record(value)
  const wrapped = first(outer, ['result', 'tableAnalysis', 'table', 'analysis'])
  const source = Object.keys(record(wrapped)).length ? record(wrapped) : outer
  const columns = stringList(first(source, ['columns', 'headers', 'columnNames']))
  const rawRows = rows(first(source, ['rows', 'dataRows', 'values', 'data']))
  const normalizedRows = rawRows.map((item) => {
    const row = record(item)
    const explicitCells = first(row, ['cells', 'values', 'row'])
    const keyedCells = columns.map((column) => Object.entries(row)
      .find(([key]) => key.toLowerCase() === column.toLowerCase())?.[1])
    const cells = Array.isArray(item) ? item
      : Array.isArray(explicitCells) ? explicitCells
        : Object.keys(row).length ? (keyedCells.some((cell) => cell !== undefined) ? keyedCells : Object.values(row))
          : [item]
    return cells.map((cell) => {
      const cellObject = record(cell)
      return {
        raw: text(first(cellObject, ['raw', 'value', 'text', 'content']), text(cell)),
        emphasized: booleanValue(first(cellObject, ['emphasized', 'bold', 'highlighted', 'isBest'])),
      }
    })
  }).filter((row) => row.some((cell) => cell.raw))
  const parsedPage = integerValue(first(source, ['pdfPageIndex', 'pageIndex', 'page']))

  return {
    label: text(first(source, ['label', 'id', 'tableLabel']), 'Table'),
    title: text(first(source, ['title', 'caption', 'name']), '未提供標題'),
    pdfPageIndex: parsedPage !== null && parsedPage >= 0 ? parsedPage : 0,
    columns,
    rows: normalizedRows,
    footnotes: stringList(first(source, ['footnotes', 'notes'])),
    observations: rows(first(source, ['observations', 'results', 'metricObservations'])).map(normalizeMetricObservation),
    positioning: stringList(first(source, ['positioning', 'comparisonPositioning', 'findings'])),
    tradeoffs: stringList(first(source, ['tradeoffs', 'tradeOffs', 'advantagesDisadvantages'])),
    limitations: stringList(first(source, ['limitations', 'limits', 'caveats'])),
    evidence: normalizeEvidence(first(source, ['evidence', 'sources', 'sourceRefs'])),
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

function tryJson(value: string): { parsed: true; value: unknown } | { parsed: false } {
  try { return { parsed: true, value: JSON.parse(value) as unknown } }
  catch { return { parsed: false } }
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function removeTrailingCommas(value: string) {
  let result = ''
  let inString = false
  let escaped = false
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    if (inString) {
      result += character
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') inString = false
      continue
    }
    if (character === '"') { inString = true; result += character; continue }
    if (character === ',') {
      let next = index + 1
      while (/\s/.test(value[next] ?? '')) next += 1
      if (value[next] === '}' || value[next] === ']') continue
    }
    result += character
  }
  return result
}

function balancedJsonObjects(value: string) {
  const objects: string[] = []
  let start = -1
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    if (start < 0) {
      if (character === '{') { start = index; depth = 1 }
      continue
    }
    if (inString) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') inString = false
      continue
    }
    if (character === '"') inString = true
    else if (character === '{') depth += 1
    else if (character === '}') {
      depth -= 1
      if (depth === 0) {
        objects.push(value.slice(start, index + 1))
        start = -1
      }
    }
  }
  return objects
}

function parseObjectCandidate(candidate: string) {
  for (const value of [candidate, removeTrailingCommas(candidate)]) {
    const result = tryJson(value)
    if (result.parsed && isJsonObject(result.value)) return result.value
  }
  return null
}

export function parseJsonResponse(raw: string): unknown {
  const cleaned = raw.trim().replace(/^\uFEFF/, '')
  const direct = tryJson(cleaned)
  if (direct.parsed) {
    if (isJsonObject(direct.value)) return direct.value
    throw new Error('API 回應的 JSON 頂層必須是 object。')
  }

  const fenced = cleaned.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1]
  if (fenced) {
    const parsed = parseObjectCandidate(fenced)
    if (parsed) return parsed
  }

  for (const candidate of balancedJsonObjects(cleaned)) {
    const parsed = parseObjectCandidate(candidate)
    if (parsed) return parsed
  }

  if (cleaned.includes('{')) throw new Error('API 回應的 JSON 可能被截斷或括號未閉合。')
  throw new Error('API 回應中找不到可辨識的 JSON object。')
}

export function schemaValidationMessage(error: unknown, stage: string) {
  if (!(error instanceof z.ZodError)) return null
  return `${stage}的 AI 回傳內容無法轉換成可用資料。系統已保留原有分析；請重試，或改用其他模型。`
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
  guideQuestions: z.array(z.string()).max(5),
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
  researchIdeas: z.array(z.object({ question: z.string(), motivation: z.string(), hypothesis: z.string(), minimumExperiment: z.string(), requiredData: z.string(), metric: z.string() })).max(5),
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
    guideQuestions: { type: 'array', maxItems: 5, items: { type: 'string' } },
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
    researchIdeas: { type: 'array', maxItems: 5, items: { type: 'object', additionalProperties: false, properties: { question: { type: 'string' }, motivation: { type: 'string' }, hypothesis: { type: 'string' }, minimumExperiment: { type: 'string' }, requiredData: { type: 'string' }, metric: { type: 'string' } }, required: ['question', 'motivation', 'hypothesis', 'minimumExperiment', 'requiredData', 'metric'] } },
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
