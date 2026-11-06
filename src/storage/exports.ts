import type { Paper, ProjectBundle } from '../domain/types'
import { richTextToHtml } from '../lib/richText'
import { migrateBundle, stripSecrets } from './projectStore'

function download(name: string, content: string, type = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

export function exportProjectJson(bundle: ProjectBundle) {
  download(`${safeName(bundle.project.name)}.papernavigator.json`, JSON.stringify(stripSecrets(bundle), null, 2), 'application/json;charset=utf-8')
}

export function importProjectJson(text: string): ProjectBundle {
  const value = JSON.parse(text) as ProjectBundle
  if (value.schemaVersion !== '1.0' || !value.project?.id || !Array.isArray(value.papers)) throw new Error('不是可支援的 PaperNavigator 專案備份。')
  return migrateBundle(value)
}

export function paperMarkdown(paper: Paper) {
  const pass1 = paper.pass1
  const pass2 = paper.pass2
  const pass3 = paper.pass3
  const evidence = (ids: string[]) => ids.map((id) => {
    const item = paper.evidence.find((row) => row.id === id)
    return item ? `PDF p.${item.pdfPageDisplay ?? '?'}「${item.quote ?? '未找到摘錄'}」[${item.verificationStatus}]` : `來源 ${id}（未找到）`
  }).join('；')
  const pass3Report = paper.pass3Text?.trim() ? richTextToHtml(paper.pass3Text) : ''
  return `# ${pass1?.title ?? paper.title ?? paper.filename}

- 檔案：${paper.filename}
- 作者：${pass1?.authors.join('、') || '未報告'}
- 年份：${pass1?.year ?? '未報告'}
- DOI：${pass1?.doi ?? '未報告'}
- 分析模型：${paper.analysisModel ?? '未記錄'}

## 第一遍

${pass1?.oneSentenceTopic ?? '尚未分析'}

### 五個 C

${pass1?.fiveCs.map((item) => `- **${item.name}**：${item.summary}\n  - 來源：${evidence(item.evidenceIds) || '未找到'}`).join('\n') ?? '尚未分析'}

### 主要貢獻

${pass1?.contributions.map((item) => `- ${item}`).join('\n') ?? '尚未分析'}

## 第二遍

### 方法流程

${pass2?.methodSteps.map((item, index) => `${index + 1}. ${item}`).join('\n') ?? '尚未分析'}

### 主張與證據

${pass2?.claims.map((item) => `- ${item.claim}\n  - 支持：${item.support}\n  - 限制：${item.limitation}\n  - 來源：${evidence(item.evidenceIds) || '未找到'}`).join('\n') ?? '尚未分析'}

## 第三遍

${pass3Report || pass3?.reconstruction.map((item) => `- **${item.step}** [${item.status}]：${item.detail}`).join('\n') || '尚未分析'}

### AI 建議的研究題目

${pass3Report ? '（第三遍已以 HTML／Markdown 報告輸出；以上內容即為完整報告。）' : pass3?.researchIdeas.map((item) => `- **${item.question}**\n  - 假設：${item.hypothesis}\n  - 最小實驗：${item.minimumExperiment}`).join('\n') || '尚未分析'}

## 螢光標記與文字定位

${paper.highlights.map((item, index) => `- 螢光標記 ${index + 1}（${item.color}）：PDF p.${item.pdfPageIndex + 1}${item.text ? `「${item.text}」` : ''}${item.aiSummary ? `\n  - AI 摘要：${item.aiSummary}` : ''}${item.translation ? `\n  - 翻譯：${item.translation}` : ''}`).join('\n') || '無螢光標記'}

${paper.evidence.map((item) => `- PDF p.${item.pdfPageDisplay ?? '?'}［${item.verificationStatus}］：${item.quote ?? item.objectLabel ?? '未提供摘錄'}`).join('\n') || '無來源定位'}

## AI 圈選摘要

${paper.aiRegionSummaries?.map((item) => `- PDF p.${item.pdfPageIndex + 1}：${item.summary}`).join('\n') || '無 AI 圈選摘要'}

## 個人筆記

${paper.notes.map((note) => `- [${note.verification}] ${note.body}`).join('\n') || '無'}
`
}

export function exportPaperMarkdown(paper: Paper) {
  download(`${safeName(paper.title ?? paper.filename)}.md`, paperMarkdown(paper), 'text/markdown;charset=utf-8')
}

export function pass3HtmlDocument(paper: Paper, text = paper.pass3Text ?? '') {
  const title = safeName(paper.title ?? paper.filename)
  const report = richTextToHtml(text)
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}－第三遍閱讀報告</title><style>body{max-width:960px;margin:40px auto;padding:0 24px;color:#293537;font:16px/1.75 system-ui,sans-serif}h1,h2,h3,h4{color:#244c50}table{width:100%;border-collapse:collapse}th,td{padding:8px;border:1px solid #ccd4d1;text-align:left}code{padding:2px 4px;background:#eef1ef}blockquote{margin-left:0;padding-left:16px;border-left:4px solid #83aaa3;color:#526166}</style></head><body><main>${report}</main></body></html>`
}

export function exportPass3Html(paper: Paper, text = paper.pass3Text ?? '') {
  download(`${safeName(paper.title ?? paper.filename)}-第三遍.html`, pass3HtmlDocument(paper, text), 'text/html;charset=utf-8')
}

function csvSafe(value: unknown) {
  let text = value === null || value === undefined ? '' : String(value)
  if (/^[=+\-@]/.test(text)) text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}

export function comparisonCsv(papers: Paper[]) {
  const rows = papers.flatMap((paper) => paper.observations.map((item) => [
    paper.title ?? paper.filename, paper.authors.join('; '), paper.year, item.task, item.dataset, item.datasetVersion,
    item.split, item.metricName, item.metricDefinition, item.rawValue, item.numericValue, item.unit,
    item.methodName, item.methodOrigin, item.pretrainedData, item.hardware, item.protocol, item.status,
  ]))
  const header = ['paper', 'authors', 'year', 'task', 'dataset', 'datasetVersion', 'split', 'metric', 'metricDefinition', 'rawValue', 'numericValue', 'unit', 'method', 'origin', 'pretraining', 'hardware', 'protocol', 'status']
  return [header, ...rows].map((row) => row.map(csvSafe).join(',')).join('\r\n')
}

export function exportComparisonCsv(papers: Paper[]) {
  download('paper-comparison.csv', `\uFEFF${comparisonCsv(papers)}`, 'text/csv;charset=utf-8')
}

export function exportBibTeX(papers: Paper[]) {
  const text = papers.map((paper, index) => {
    const key = `${(paper.authors[0] ?? 'unknown').split(/\s+/).at(-1) ?? 'unknown'}${paper.year ?? 'nd'}${index + 1}`.replace(/[^a-z0-9]/gi, '')
    return `@article{${key},\n  title = {${paper.title ?? paper.filename}},\n  author = {${paper.authors.join(' and ') || 'Unknown'}},\n  year = {${paper.year ?? ''}},\n  doi = {${paper.doi ?? ''}}\n}`
  }).join('\n\n')
  download('papernavigator-library.bib', text)
}

export function exportRis(papers: Paper[]) {
  const text = papers.map((paper) => ['TY  - JOUR', `TI  - ${paper.title ?? paper.filename}`, ...paper.authors.map((author) => `AU  - ${author}`), `PY  - ${paper.year ?? ''}`, `DO  - ${paper.doi ?? ''}`, 'ER  - '].join('\n')).join('\n\n')
  download('papernavigator-library.ris', text)
}

function safeName(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || 'PaperNavigator'
}
