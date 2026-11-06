import type { PdfDocumentData, ProjectBundle } from '../domain/types'

const DATABASE = 'papernavigator.v1'
const STORE = 'workspace'
const PDF_STORE = 'pdfs'
const KEY = 'current'

interface StoredPdf {
  paperId: string
  file: Blob
  filename: string
  fileType: string
  lastModified: number
  metadata: Omit<PdfDocumentData, 'file' | 'bytes'>
}

export function stripSecrets<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (key, item) => /^(apiKey|api_key|token|accessToken|bytes|file)$/i.test(key) ? undefined : item)) as T
}

export function migrateBundle(value: ProjectBundle): ProjectBundle {
  if (!value || value.schemaVersion !== '1.0' || !value.project || !Array.isArray(value.papers)) throw new Error('不支援的專案資料格式。')
  const clean = stripSecrets(value)
  return {
    schemaVersion: '1.0',
    exportedAt: clean.exportedAt ?? new Date().toISOString(),
    project: {
      ...clean.project,
      researchQuestion: clean.project.researchQuestion ?? '',
      paperIds: clean.papers.map((paper) => paper.id),
    },
    papers: clean.papers.map((paper) => ({
      ...paper,
      size: paper.size ?? 0,
      tableAnalyses: paper.tableAnalyses ?? [],
      citations: paper.citations ?? paper.pass2?.references ?? [],
      evidence: paper.evidence ?? [],
      observations: paper.observations ?? [],
      notes: paper.notes ?? [],
      floatingNote: paper.floatingNote ?? '',
      highlights: paper.highlights ?? [],
      pdfTranslations: paper.pdfTranslations ?? [],
      aiRegionSummaries: paper.aiRegionSummaries ?? [],
    })),
    comparisons: clean.comparisons ?? [],
  }
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 2)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE)
      if (!request.result.objectStoreNames.contains(PDF_STORE)) request.result.createObjectStore(PDF_STORE, { keyPath: 'paperId' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function saveBundle(bundle: ProjectBundle) {
  const db = await openDatabase()
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite')
    transaction.objectStore(STORE).put(stripSecrets(bundle), KEY)
    transaction.oncomplete = () => { db.close(); resolve() }
    transaction.onerror = () => { db.close(); reject(transaction.error) }
  })
}

export async function loadBundle(): Promise<ProjectBundle | null> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE).objectStore(STORE).get(KEY)
    request.onsuccess = () => {
      db.close()
      try { resolve(request.result ? migrateBundle(request.result as ProjectBundle) : null) }
      catch { resolve(null) }
    }
    request.onerror = () => { db.close(); reject(request.error) }
  })
}

export async function clearBundle() {
  const db = await openDatabase()
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction([STORE, PDF_STORE], 'readwrite')
    transaction.objectStore(STORE).delete(KEY)
    transaction.objectStore(PDF_STORE).clear()
    transaction.oncomplete = () => { db.close(); resolve() }
    transaction.onerror = () => { db.close(); reject(transaction.error) }
  })
}

export async function savePdfDocument(paperId: string, document: PdfDocumentData) {
  const db = await openDatabase()
  const { file: _file, bytes: _bytes, ...metadata } = document
  const stored: StoredPdf = {
    paperId,
    file: document.file,
    filename: document.filename,
    fileType: document.file.type || 'application/pdf',
    lastModified: document.file.lastModified,
    metadata,
  }
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(PDF_STORE, 'readwrite')
    transaction.objectStore(PDF_STORE).put(stored)
    transaction.oncomplete = () => { db.close(); resolve() }
    transaction.onerror = () => { db.close(); reject(transaction.error) }
  })
}

export async function loadPdfDocuments(paperIds: string[]) {
  if (!paperIds.length) return {} as Record<string, PdfDocumentData>
  const db = await openDatabase()
  return new Promise<Record<string, PdfDocumentData>>((resolve, reject) => {
    const request = db.transaction(PDF_STORE).objectStore(PDF_STORE).getAll()
    request.onsuccess = async () => {
      db.close()
      try {
        const wanted = new Set(paperIds)
        const documents: Record<string, PdfDocumentData> = {}
        for (const row of request.result as StoredPdf[]) {
          if (!wanted.has(row.paperId)) continue
          const file = row.file instanceof File
            ? row.file
            : new File([row.file], row.filename, { type: row.fileType, lastModified: row.lastModified })
          documents[row.paperId] = { ...row.metadata, file, bytes: new Uint8Array(await row.file.arrayBuffer()) }
        }
        resolve(documents)
      } catch (error) { reject(error) }
    }
    request.onerror = () => { db.close(); reject(request.error) }
  })
}

export async function deletePdfDocument(paperId: string) {
  const db = await openDatabase()
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(PDF_STORE, 'readwrite')
    transaction.objectStore(PDF_STORE).delete(paperId)
    transaction.oncomplete = () => { db.close(); resolve() }
    transaction.onerror = () => { db.close(); reject(transaction.error) }
  })
}

export async function clearPdfDocuments() {
  const db = await openDatabase()
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(PDF_STORE, 'readwrite')
    transaction.objectStore(PDF_STORE).clear()
    transaction.oncomplete = () => { db.close(); resolve() }
    transaction.onerror = () => { db.close(); reject(transaction.error) }
  })
}
