import type { CitationRecord, Paper } from '../domain/types'

export async function verifyCitation(citation: CitationRecord): Promise<CitationRecord> {
  if (!citation.doi) throw new Error('此引用沒有 DOI，無法自動核對。')
  const response = await fetch(`https://api.crossref.org/works/${encodeURIComponent(citation.doi)}`)
  if (!response.ok) throw new Error(`Crossref 查無此 DOI（HTTP ${response.status}）。`)
  const item = (await response.json()).message as { title?: string[]; author?: Array<{ given?: string; family?: string }>; published?: { 'date-parts'?: number[][] } }
  return {
    ...citation,
    title: item.title?.[0] ?? citation.title,
    authors: Array.isArray(item.author) ? item.author.map((author) => [author.given, author.family].filter(Boolean).join(' ')) : citation.authors,
    year: item.published?.['date-parts']?.[0]?.[0] ?? citation.year,
    verification: 'externally_verified',
  }
}

function citationKey(citation: CitationRecord) {
  return citation.doi?.toLowerCase() ?? `${citation.authors[0] ?? ''}|${citation.year ?? ''}|${citation.title ?? citation.raw}`.toLocaleLowerCase().replace(/\s+/g, ' ').trim()
}

export function coCitationRows(papers: Paper[]) {
  const map = new Map<string, { citation: CitationRecord; paperIds: Set<string> }>()
  for (const paper of papers) {
    for (const citation of paper.citations) {
      const key = citationKey(citation)
      const existing = map.get(key) ?? { citation, paperIds: new Set<string>() }
      existing.paperIds.add(paper.id)
      map.set(key, existing)
    }
  }
  return [...map.values()].map((item) => ({ citation: item.citation, paperIds: [...item.paperIds], count: item.paperIds.size })).sort((a, b) => b.count - a.count)
}
