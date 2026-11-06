export type InformationStatus = 'reported' | 'inferred' | 'not_reported' | 'unknown'
export type VerificationStatus = 'matched' | 'unverified' | 'mismatch'
export type ReadingDecision = 'continue' | 'later' | 'stop'
export type ProviderId = 'google' | 'cgu'
export type PdfHighlightColor = 'yellow' | 'green' | 'pink' | 'blue'

export interface PdfHighlight {
  id: string
  paperId: string
  pdfPageIndex: number
  x: number
  y: number
  width: number
  height: number
  color: PdfHighlightColor
  text?: string
  rects?: PdfHighlightRect[]
  aiSummary?: string
  translation?: string
  createdAt: string
}

export interface PdfHighlightRect {
  x: number
  y: number
  width: number
  height: number
}

export interface AiRegionSummary {
  id: string
  paperId: string
  pdfPageIndex: number
  summary: string
  createdAt: string
}

export interface SourceEvidence {
  id: string
  paperId: string
  pdfPageIndex: number | null
  pdfPageDisplay: number | null
  printedPage: string | null
  section: string | null
  objectType: 'text' | 'table' | 'figure' | 'unknown'
  objectLabel: string | null
  quote: string | null
  verificationStatus: VerificationStatus
  notes: string | null
}

export interface FiveCItem {
  name: 'Category' | 'Context' | 'Correctness' | 'Contributions' | 'Clarity'
  summary: string
  evidenceIds: string[]
}

export interface Pass1Result {
  schemaVersion: '1.0'
  promptVersion: 'pass1.v1'
  title: string | null
  authors: string[]
  year: number | null
  doi: string | null
  oneSentenceTopic: string
  researchQuestion: string
  field: string
  paperType: string
  outline: string[]
  fiveCs: FiveCItem[]
  contributions: string[]
  readingDecision: {
    recommendation: ReadingDecision
    reason: string
  }
  unclearConcepts: string[]
  evidence: SourceEvidence[]
}

export interface MetricObservation {
  id: string
  paperId: string
  methodName: string
  methodOrigin: 'paper_proposed' | 'reproduced_baseline' | 'cited_prior_work'
  task: string
  dataset: string | null
  datasetVersion: string | null
  split: string | null
  metricName: string
  metricDefinition: string | null
  direction: 'higher' | 'lower' | 'unknown'
  rawValue: string
  numericValue: number | null
  unit: string | null
  dispersion: string | null
  pretrainedData: string | null
  hardware: string | null
  protocol: string | null
  status: InformationStatus
  evidenceIds: string[]
}

export interface Paper {
  id: string
  projectId: string
  sha256: string
  filename: string
  title: string | null
  authors: string[]
  year: number | null
  doi: string | null
  pageCount: number
  size: number
  uploadTime: string
  pass1?: Pass1Result
  pass2?: Pass2Result
  pass3?: Pass3Result
  tableAnalyses: TableAnalysis[]
  citations: CitationRecord[]
  evidence: SourceEvidence[]
  observations: MetricObservation[]
  notes: UserNote[]
  highlights: PdfHighlight[]
  aiRegionSummaries?: AiRegionSummary[]
  analysisModel?: string
  promptVersion?: string
}

export interface UserNote {
  id: string
  paperId: string
  body: string
  verification: 'checked' | 'pending' | 'concern'
  createdAt: string
  updatedAt: string
}

export interface Project {
  id: string
  name: string
  researchQuestion: string
  paperIds: string[]
  createdAt: string
  updatedAt: string
}

export interface Pass2Result {
  schemaVersion: '1.0'
  promptVersion: 'pass2.v1'
  motivation: string
  problemDefinition: string
  inputOutput: string
  methodSteps: string[]
  modules: string[]
  trainingSetup: string | null
  inferenceSetup: string | null
  datasets: DatasetRecord[]
  metrics: MetricRecord[]
  figures: FigureTableIndex[]
  tables: FigureTableIndex[]
  claims: ClaimEvidence[]
  guideQuestions: string[]
  observations: MetricObservation[]
  references: CitationRecord[]
  evidence: SourceEvidence[]
}

export interface Pass3Result {
  schemaVersion: '1.0'
  promptVersion: 'pass3.v1'
  reconstruction: ReconstructionItem[]
  assumptions: CriticalItem[]
  threats: CriticalItem[]
  reproducibilityRisks: CriticalItem[]
  researchIdeas: ResearchIdea[]
}

export interface DatasetRecord {
  name: string
  version: string | null
  size: string | null
  split: string | null
  externalValidation: string | null
  leakageRisk: string | null
  status: InformationStatus
  evidenceIds: string[]
}

export interface MetricRecord {
  name: string
  definition: string | null
  direction: 'higher' | 'lower' | 'unknown'
  unit: string | null
  evidenceIds: string[]
}

export interface FigureTableIndex {
  label: string
  title: string
  pdfPageIndex: number | null
  purpose: string
  interpretation: string
  checkItems: string[]
}

export interface ClaimEvidence {
  claim: string
  support: string
  limitation: string
  evidenceIds: string[]
}

export interface ReconstructionItem {
  step: string
  detail: string
  status: 'explicit' | 'implicit' | 'missing'
  evidenceIds: string[]
}

export interface CriticalItem {
  title: string
  assessment: string
  status: 'confirmed' | 'needs_verification' | 'indeterminate'
  evidenceIds: string[]
}

export interface ResearchIdea {
  question: string
  motivation: string
  hypothesis: string
  minimumExperiment: string
  requiredData: string
  metric: string
}

export interface TableCell {
  raw: string
  emphasized: boolean
}

export interface TableAnalysis {
  id: string
  paperId: string
  label: string
  title: string
  pdfPageIndex: number
  columns: string[]
  rows: TableCell[][]
  footnotes: string[]
  observations: MetricObservation[]
  evidence: SourceEvidence[]
  positioning: string[]
  tradeoffs: string[]
  limitations: string[]
  createdAt: string
}

export interface CitationRecord {
  id: string
  raw: string
  title: string | null
  authors: string[]
  year: number | null
  doi: string | null
  verification: 'paper_only' | 'externally_verified' | 'unverified'
}

export interface ComparisonSet {
  id: string
  projectId: string
  paperIds: string[]
  task: string | null
  dataset: string | null
  metric: string | null
}

export interface ProjectBundle extends StoredSchemaVersion {
  project: Project
  papers: Paper[]
  comparisons: ComparisonSet[]
  exportedAt: string
}

export interface ComparabilityAssessment {
  label: 'direct' | 'reference_only' | 'not_comparable' | 'insufficient'
  reasons: string[]
}

export interface AnalysisJob {
  id: string
  paperId: string
  stage: 'pass1' | 'pass2' | 'pass3' | 'table' | 'compare'
  state: 'queued' | 'requesting' | 'validating' | 'complete' | 'partial' | 'failed' | 'cancelled'
  error: string | null
}

export interface StoredSchemaVersion {
  schemaVersion: '1.0'
}

export interface ProviderConfig {
  id: ProviderId
  apiKey: string
  baseUrl: string
  modelId: string
}

export interface ModelInfo {
  id: string
  displayName: string
}

export interface PdfDocumentData {
  file: File
  bytes: Uint8Array
  sha256: string
  filename: string
  pageCount: number
  size: number
  title: string | null
  author: string | null
  pagesText: string[]
  hasExtractableText: boolean
  warnings: string[]
}

export interface AnalysisUsage {
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
}

export interface AnalysisResponse {
  result: Pass1Result
  usage: AnalysisUsage
  rawText: string
}
