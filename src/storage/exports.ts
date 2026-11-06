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

## 筆記

${[paper.floatingNote?.trim() ? `- ${paper.floatingNote.trim()}` : '', ...paper.notes.map((note) => `- [${note.verification}] ${note.body}`)].filter(Boolean).join('\n') || '無'}
`
}

export function exportPaperMarkdown(paper: Paper) {
  download(`${safeName(paper.title ?? paper.filename)}.md`, paperMarkdown(paper), 'text/markdown;charset=utf-8')
}

export function pass3HtmlDocument(paper: Paper, text = paper.pass3Text ?? '') {
  const title = safeName(paper.title ?? paper.filename)
  const report = richTextToHtml(text)
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}－第三遍閱讀報告</title><style>body{max-width:960px;margin:40px auto;padding:0 24px;background:#fff;color:#111;font:16px/1.75 system-ui,sans-serif}h1,h2,h3,h4{color:#111}table{width:100%;border-collapse:collapse}th,td{padding:8px;border:1px solid #ccd4d1;text-align:left}code{padding:2px 4px;background:#f3f4f6}blockquote{margin-left:0;padding-left:16px;border-left:4px solid #83aaa3;color:#111}</style></head><body><main>${report}</main></body></html>`
}

export function exportPass3Html(paper: Paper, text = paper.pass3Text ?? '') {
  download(`${safeName(paper.title ?? paper.filename)}-第三遍.html`, pass3HtmlDocument(paper, text), 'text/html;charset=utf-8')
}

function escapeHtml(value: unknown) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function reportValue(value: unknown, fallback = '未報告') {
  if (value === null || value === undefined || value === '') return fallback
  return escapeHtml(value)
}

function reportList(items: string[], empty = '未報告') {
  return items.length ? `<ol>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ol>` : `<p class="empty">${empty}</p>`
}

function reportText(value: string) {
  return escapeHtml(value).replace(/\r?\n/g, '<br>')
}

function safeScreenshotDataUrl(value: string) {
  return /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/]+=*$/i.test(value) ? value : ''
}

function fullReportEvidenceIds(paper: Paper) {
  const ids: string[] = []
  const add = (values: string[]) => values.forEach((id) => { if (id && !ids.includes(id)) ids.push(id) })
  paper.pass1?.fiveCs.forEach((item) => add(item.evidenceIds))
  paper.pass2?.datasets.forEach((item) => add(item.evidenceIds))
  paper.pass2?.metrics.forEach((item) => add(item.evidenceIds))
  paper.pass2?.claims.forEach((item) => add(item.evidenceIds))
  paper.pass2?.observations.forEach((item) => add(item.evidenceIds))
  paper.pass3?.reconstruction.forEach((item) => add(item.evidenceIds))
  paper.pass3?.assumptions.forEach((item) => add(item.evidenceIds))
  paper.pass3?.threats.forEach((item) => add(item.evidenceIds))
  paper.pass3?.reproducibilityRisks.forEach((item) => add(item.evidenceIds))
  return ids
}

export function fullReportHtmlDocument(paper: Paper) {
  if (!paper.pass1 || !paper.pass2 || (!paper.pass3 && !paper.pass3Text?.trim())) {
    throw new Error('請先完成三遍閱讀，再開啟 A4 完整報告。')
  }

  const pass1 = paper.pass1
  const pass2 = paper.pass2
  const pass3 = paper.pass3
  const evidenceIds = fullReportEvidenceIds(paper)
  const evidenceNumber = new Map(evidenceIds.map((id, index) => [id, index + 1]))
  const evidenceRefs = (ids: string[]) => {
    const refs = ids.map((id) => evidenceNumber.get(id)).filter((value): value is number => value !== undefined)
    return refs.length ? `<span class="evidence-refs">${refs.map((number) => `<a href="#evidence-${number}">[E${number}]</a>`).join(' ')}</span>` : ''
  }
  const infoStatus = (status: string) => ({ reported: '已報告', inferred: '推論', not_reported: '未報告', unknown: '未知' }[status] ?? status)
  const criticalStatus = (status: string) => ({ confirmed: '已確認', needs_verification: '待查證', indeterminate: '無法判定' }[status] ?? status)
  const reconstructionStatus = (status: string) => ({ explicit: '明確敘述', implicit: '隱含', missing: '缺漏' }[status] ?? status)
  const decision = ({ continue: '繼續深入', later: '稍後閱讀', stop: '暫停閱讀' } as Record<string, string>)[pass1.readingDecision.recommendation]

  const datasets = pass2.datasets.length ? `<div class="table-wrap"><table><thead><tr><th>資料集</th><th>版本／規模</th><th>Split</th><th>外部驗證</th><th>洩漏風險</th><th>狀態</th></tr></thead><tbody>${pass2.datasets.map((item) => `<tr><td>${escapeHtml(item.name)} ${evidenceRefs(item.evidenceIds)}</td><td>${reportValue([item.version, item.size].filter(Boolean).join(' · '))}</td><td>${reportValue(item.split)}</td><td>${reportValue(item.externalValidation)}</td><td>${reportValue(item.leakageRisk)}</td><td>${escapeHtml(infoStatus(item.status))}</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">未報告資料集。</p>'
  const metrics = pass2.metrics.length ? `<div class="table-wrap"><table><thead><tr><th>指標</th><th>定義</th><th>方向</th><th>單位</th></tr></thead><tbody>${pass2.metrics.map((item) => `<tr><td>${escapeHtml(item.name)} ${evidenceRefs(item.evidenceIds)}</td><td>${reportValue(item.definition)}</td><td>${reportValue(item.direction)}</td><td>${reportValue(item.unit)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">未報告評估指標。</p>'
  const observations = pass2.observations.length ? `<div class="table-wrap"><table><thead><tr><th>方法</th><th>任務／資料集</th><th>指標</th><th>結果</th><th>設定</th><th>狀態</th></tr></thead><tbody>${pass2.observations.map((item) => `<tr><td>${escapeHtml(item.methodName)} ${evidenceRefs(item.evidenceIds)}<small>${escapeHtml(item.methodOrigin)}</small></td><td>${escapeHtml(item.task)}<small>${reportValue([item.dataset, item.datasetVersion, item.split].filter(Boolean).join(' · '))}</small></td><td>${escapeHtml(item.metricName)}<small>${reportValue(item.metricDefinition)}</small></td><td>${escapeHtml(item.rawValue)}<small>${reportValue(item.dispersion)}</small></td><td>${reportValue([item.pretrainedData && `預訓練：${item.pretrainedData}`, item.hardware && `硬體：${item.hardware}`, item.protocol].filter(Boolean).join('；'))}</td><td>${escapeHtml(infoStatus(item.status))}</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">未擷取實驗結果。</p>'
  const figureTables = [...pass2.figures, ...pass2.tables]
  const indexes = figureTables.length ? figureTables.map((item) => `<article class="item"><h4>${escapeHtml(item.label)}｜${escapeHtml(item.title)}</h4><p><b>用途：</b>${escapeHtml(item.purpose)}</p><p><b>解讀：</b>${escapeHtml(item.interpretation)}</p><p><b>頁碼：</b>${item.pdfPageIndex === null ? '待確認' : `PDF p.${item.pdfPageIndex + 1}`}</p>${item.checkItems.length ? `<p><b>檢查項目：</b>${item.checkItems.map(escapeHtml).join('；')}</p>` : ''}</article>`).join('') : '<p class="empty">沒有 Figure／Table 索引。</p>'
  const references = pass2.references.length ? `<ol>${pass2.references.map((item) => `<li>${escapeHtml(item.raw || [item.authors.join(', '), item.title, item.year, item.doi].filter(Boolean).join('. '))} <span class="status">${escapeHtml(item.verification)}</span></li>`).join('')}</ol>` : '<p class="empty">沒有擷取參考文獻。</p>'

  const structuredPass3 = pass3 ? `
    <h3>重建程序</h3>
    ${pass3.reconstruction.length ? pass3.reconstruction.map((item, index) => `<article class="item"><h4>${index + 1}. ${escapeHtml(item.step)} <span class="status">${escapeHtml(reconstructionStatus(item.status))}</span></h4><p>${escapeHtml(item.detail)} ${evidenceRefs(item.evidenceIds)}</p></article>`).join('') : '<p class="empty">沒有重建程序。</p>'}
    ${([['隱藏假設', pass3.assumptions], ['效度威脅', pass3.threats], ['可重現性風險', pass3.reproducibilityRisks]] as const).map(([title, items]) => `<h3>${title}</h3>${items.length ? items.map((item) => `<article class="item"><h4>${escapeHtml(item.title)} <span class="status">${escapeHtml(criticalStatus(item.status))}</span></h4><p>${escapeHtml(item.assessment)} ${evidenceRefs(item.evidenceIds)}</p></article>`).join('') : `<p class="empty">沒有${title}。</p>`}`).join('')}
    <h3>後續研究題目</h3>
    ${pass3.researchIdeas.length ? pass3.researchIdeas.map((item, index) => `<article class="idea"><h4>研究題目 ${index + 1}｜${escapeHtml(item.question)}</h4><p><b>動機：</b>${escapeHtml(item.motivation)}</p><p><b>假設：</b>${escapeHtml(item.hypothesis)}</p><p><b>最小實驗：</b>${escapeHtml(item.minimumExperiment)}</p><p><b>所需資料：</b>${escapeHtml(item.requiredData)}</p><p><b>評估指標：</b>${escapeHtml(item.metric)}</p></article>`).join('') : '<p class="empty">沒有後續研究題目。</p>'}` : ''
  const thirdPass = paper.pass3Text?.trim() ? `<div class="model-report">${richTextToHtml(paper.pass3Text)}</div>` : structuredPass3

  const evidenceAppendix = evidenceIds.length ? evidenceIds.map((id, index) => {
    const item = paper.evidence.find((row) => row.id === id)
    if (!item) return `<tr id="evidence-${index + 1}"><td>E${index + 1}</td><td colspan="4">找不到來源資料（${escapeHtml(id)}）</td></tr>`
    const location = [item.pdfPageDisplay !== null ? `PDF p.${item.pdfPageDisplay}` : null, item.printedPage ? `印刷頁 ${item.printedPage}` : null, item.section].filter(Boolean).join(' · ')
    return `<tr id="evidence-${index + 1}"><td>E${index + 1}</td><td>${reportValue(location, '頁碼未確認')}</td><td>${reportValue(item.objectLabel ?? item.objectType)}</td><td>${reportValue(item.quote, '未提供摘錄')}${item.notes ? `<small>${escapeHtml(item.notes)}</small>` : ''}</td><td>${escapeHtml(({ matched: '已定位', unverified: '待核對', mismatch: '位置異常' } as Record<string, string>)[item.verificationStatus])}</td></tr>`
  }).join('') : '<tr><td colspan="5">三遍分析沒有引用證據。</td></tr>'

  const highlightAppendix = paper.highlights.length ? paper.highlights.map((item, index) => `<article class="annotation-item"><h4>重點標記 ${index + 1} · PDF p.${item.pdfPageIndex + 1}</h4><blockquote>${item.text?.trim() ? reportText(item.text.trim()) : '沒有擷取文字'}</blockquote>${item.aiSummary?.trim() ? `<div class="annotation-output"><b>AI 摘要</b><p>${reportText(item.aiSummary.trim())}</p></div>` : ''}${item.translation?.trim() ? `<div class="annotation-output"><b>翻譯</b><p>${reportText(item.translation.trim())}</p></div>` : ''}</article>`).join('') : '<p class="empty">沒有重點標記。</p>'
  const screenshotAppendix = (paper.screenshots ?? []).map((item, index) => ({ item, index, src: safeScreenshotDataUrl(item.dataUrl) })).filter((row) => row.src).map(({ item, index, src }) => `<figure class="report-screenshot"><img src="${src}" alt="PDF 第 ${item.pdfPageIndex + 1} 頁截圖 ${index + 1}"><figcaption>截圖 ${index + 1} · PDF p.${item.pdfPageIndex + 1}</figcaption></figure>`).join('') || '<p class="empty">沒有截圖。</p>'
  const noteRows = [paper.floatingNote?.trim() ?? '', ...paper.notes.map((note) => note.body.trim())].filter(Boolean)
  const noteAppendix = noteRows.length ? noteRows.map((note, index) => `<article class="note-box"><h4>筆記 ${index + 1}</h4><p>${reportText(note)}</p></article>`).join('') : '<p class="empty">沒有筆記。</p>'

  const title = pass1.title ?? paper.title ?? paper.filename
  const generatedAt = new Date().toLocaleString('zh-TW', { hour12: false })
  return `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}－三遍閱讀報告</title>
<style>
@page{size:A4;margin:15mm 14mm 16mm}*{box-sizing:border-box}html{background:#e9ecea}body{max-width:210mm;margin:24px auto;padding:15mm 14mm;background:#fff;color:#18201e;font:10.5pt/1.65 system-ui,-apple-system,"Noto Sans TC","Microsoft JhengHei",sans-serif;overflow-wrap:anywhere}h1,h2,h3,h4{margin:0 0 3mm;line-height:1.35;color:#12211e;break-after:avoid}h1{font-size:25pt}h2{padding-bottom:2.5mm;border-bottom:1.5pt solid #467970;font-size:18pt}h3{margin-top:7mm;font-size:13pt}h4{font-size:10.5pt}p{margin:0 0 3mm}ol,ul{margin:0 0 4mm;padding-left:6mm}li{margin:1.5mm 0}.cover{min-height:250mm;display:flex;flex-direction:column;justify-content:center}.cover .kicker,.section-kicker{color:#467970;font-size:9pt;font-weight:750;letter-spacing:.16em;text-transform:uppercase}.cover .subtitle{margin:3mm 0 16mm;color:#52615d;font-size:14pt}.metadata{display:grid;grid-template-columns:28mm 1fr;margin-top:8mm;border-top:1px solid #ccd6d3}.metadata dt,.metadata dd{margin:0;padding:2.5mm 0;border-bottom:1px solid #e1e6e4}.metadata dt{font-weight:700}.report-section{break-before:page}.lead{padding:5mm;border-left:4px solid #467970;background:#f2f6f5}.two-column{display:grid;grid-template-columns:1fr 1fr;gap:5mm}.item,.idea,.annotation-item,.note-box{margin:0 0 4mm;padding:4mm;border:1px solid #d5ddda;border-radius:2mm;break-inside:avoid}.idea{border-left:4px solid #83aaa3}.annotation-item blockquote{margin:0 0 3mm;padding:3mm;border-left:3px solid #d6b44d;background:#fff9e8}.annotation-output{margin-top:2mm;padding:3mm;background:#f2f6f5}.annotation-output b{color:#315d55}.annotation-output p{margin:1mm 0 0}.note-box{border-left:4px solid #d6b44d;background:#fffdf4}.report-screenshot{margin:0 0 6mm;break-inside:avoid}.report-screenshot img{display:block;max-width:100%;max-height:230mm;margin:0 auto;border:1px solid #bfcac7}.report-screenshot figcaption{margin-top:2mm;color:#52615d;font-size:8.5pt;text-align:center}.status{display:inline-block;padding:.3mm 1.5mm;border-radius:99px;background:#e7efed;color:#315d55;font-size:8.5pt;white-space:nowrap}.evidence-refs{white-space:nowrap}.evidence-refs a{color:#2f6c62;text-decoration:none;font-weight:700}.table-wrap{width:100%;margin:0 0 5mm;overflow-wrap:anywhere}table{width:100%;border-collapse:collapse;font-size:8.5pt;table-layout:fixed}thead{display:table-header-group}tr{break-inside:avoid}th,td{padding:2mm;border:1px solid #bfcac7;text-align:left;vertical-align:top}th{background:#edf3f1}td small{display:block;margin-top:1mm;color:#52615d}.empty{color:#6b7774;font-style:italic}.model-report section+section{margin-top:7mm;padding-top:5mm;border-top:1px solid #d5ddda}.model-report table{margin-bottom:5mm}.evidence-table th:nth-child(1){width:10mm}.evidence-table th:nth-child(2){width:30mm}.evidence-table th:nth-child(3){width:24mm}.evidence-table th:nth-child(5){width:18mm}.print-note{margin-top:12mm;color:#6b7774;font-size:8.5pt;text-align:center}
@media print{html,body{background:#fff}body{max-width:none;margin:0;padding:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}.cover{min-height:250mm}.table-wrap{overflow:visible}a{color:inherit}.print-note{display:none}}
@media(max-width:700px){body{margin:0;padding:18px}.cover{min-height:auto}.two-column{grid-template-columns:1fr}.table-wrap{overflow-x:auto}table{min-width:680px}}
</style></head><body>
<header class="cover"><span class="kicker">PaperNavigator · Three-pass reading report</span><h1>${escapeHtml(title)}</h1><p class="subtitle">三遍閱讀完整報告</p><dl class="metadata"><dt>作者</dt><dd>${pass1.authors.length ? pass1.authors.map(escapeHtml).join('、') : '未報告'}</dd><dt>年份</dt><dd>${reportValue(pass1.year)}</dd><dt>DOI</dt><dd>${reportValue(pass1.doi)}</dd><dt>原始檔案</dt><dd>${escapeHtml(paper.filename)}（${paper.pageCount} 頁）</dd><dt>分析模型</dt><dd>${reportValue(paper.analysisModel, '未記錄')}</dd><dt>產生時間</dt><dd>${escapeHtml(generatedAt)}</dd></dl><p class="print-note">請使用瀏覽器列印功能，選擇 A4、縮放 100%。</p></header>
<main>
<section class="report-section"><span class="section-kicker">Pass 1 · Survey</span><h2>第一遍：鳥瞰</h2><div class="lead"><h3>${escapeHtml(pass1.oneSentenceTopic)}</h3><p><b>研究問題：</b>${escapeHtml(pass1.researchQuestion)}</p><p><b>領域／類型：</b>${escapeHtml(pass1.field)}／${escapeHtml(pass1.paperType)}</p><p><b>閱讀建議：</b>${escapeHtml(decision)}。${escapeHtml(pass1.readingDecision.reason)}</p></div><h3>論文大綱</h3>${reportList(pass1.outline)}<h3>Five Cs</h3>${pass1.fiveCs.map((item) => `<article class="item"><h4>${escapeHtml(item.name)}</h4><p>${escapeHtml(item.summary)} ${evidenceRefs(item.evidenceIds)}</p></article>`).join('')}<div class="two-column"><div><h3>主要貢獻</h3>${reportList(pass1.contributions)}</div><div><h3>待釐清概念</h3>${reportList(pass1.unclearConcepts)}</div></div></section>
<section class="report-section"><span class="section-kicker">Pass 2 · Understand</span><h2>第二遍：理解</h2><div class="two-column"><div><h3>研究動機</h3><p>${escapeHtml(pass2.motivation)}</p><h3>問題定義</h3><p>${escapeHtml(pass2.problemDefinition)}</p><h3>輸入與輸出</h3><p>${escapeHtml(pass2.inputOutput)}</p></div><div><h3>方法流程</h3>${reportList(pass2.methodSteps)}<h3>方法模組</h3>${reportList(pass2.modules)}</div></div><h3>訓練與推論設定</h3><p><b>訓練：</b>${reportValue(pass2.trainingSetup)}</p><p><b>推論：</b>${reportValue(pass2.inferenceSetup)}</p><h3>資料集</h3>${datasets}<h3>評估指標</h3>${metrics}<h3>實驗結果</h3>${observations}<h3>Figure／Table 索引</h3>${indexes}<h3>作者主張、證據與限制</h3>${pass2.claims.length ? pass2.claims.map((item) => `<article class="item"><h4>${escapeHtml(item.claim)} ${evidenceRefs(item.evidenceIds)}</h4><p><b>支持：</b>${escapeHtml(item.support)}</p><p><b>限制：</b>${escapeHtml(item.limitation)}</p></article>`).join('') : '<p class="empty">沒有擷取作者主張。</p>'}<h3>引導問題</h3>${reportList(pass2.guideQuestions)}<h3>參考文獻</h3>${references}</section>
<section class="report-section"><span class="section-kicker">Pass 3 · Reconstruct</span><h2>第三遍：重建與批判</h2>${thirdPass}</section>
<section class="report-section"><span class="section-kicker">Evidence appendix</span><h2>證據附錄</h2><p>正文中的證據編號對應以下 PDF 來源；核對狀態沿用分析當下的結果。</p><div class="table-wrap"><table class="evidence-table"><thead><tr><th>編號</th><th>位置</th><th>類型</th><th>原文摘錄</th><th>狀態</th></tr></thead><tbody>${evidenceAppendix}</tbody></table></div></section>
<section class="report-section"><span class="section-kicker">Reading appendix</span><h2>個人閱讀附錄</h2><h3>重點標記</h3>${highlightAppendix}<h3>截圖</h3>${screenshotAppendix}<h3>筆記</h3>${noteAppendix}</section>
</main></body></html>`
}

export function openFullReportHtml(paper: Paper) {
  const opened = window.open('about:blank', '_blank')
  if (!opened) return false
  opened.opener = null
  opened.document.open()
  opened.document.write(fullReportHtmlDocument(paper))
  opened.document.close()
  return true
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
