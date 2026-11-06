import type { Pass1Result, Pass2Result, PdfHighlight, UserNote } from '../../domain/types'
import { wrapUntrusted } from '../security'

export const PASS1_PROMPT_VERSION = 'pass1.v1'
export const PASS2_PROMPT_VERSION = 'pass2.v1'
export const PASS3_PROMPT_VERSION = 'pass3.v1'
export const TABLE_PROMPT_VERSION = 'table.v1'

export function pass1Prompt(researchQuestion: string) {
  return `執行 Keshav 三遍閱讀法的第一遍。請逐頁閱讀完整 PDF，不能只根據第一頁或前段內容推斷；輸出符合 schema 的 JSON。完成 metadata、≤60 字研究主題、研究問題、領域、類型、章節大綱、五個 C、最多三項貢獻、閱讀建議與待釐清概念。
Correctness 只能標示為初步檢視。若使用者未提供研究問題，不得捏造相關分數。每個事實透過 evidenceIds 指向 evidence；每筆 evidence 使用 PDF 實體頁的 0-based pdfPageIndex 與 1-based pdfPageDisplay，quote 必須是短摘錄。找不到時用 null 與 unverified。
使用者研究問題：${wrapUntrusted('research-question', researchQuestion || '未提供')}`
}

export function pass2Prompt(pass1: Pass1Result) {
  return `執行第二遍閱讀。請逐頁閱讀完整 PDF，不能只分析單一頁面；只根據論文提取研究動機、問題定義、輸入輸出、方法步驟、模組、訓練與推理設定、資料集、指標、Figure/Table 索引、主張與證據、3–5 個引導問題、逐列 MetricObservation、references 與 evidence。
觀測值必須保留 rawValue；不存在的數值填 null 且 status=not_reported，絕不可用 0。paper_proposed、reproduced_baseline、cited_prior_work 必須分開。表格頁碼用 0-based pdfPageIndex。
第一遍結果僅供脈絡，不得把其中內容當成新證據：${wrapUntrusted('pass1-cache', JSON.stringify(pass1))}`
}

export function pass3Prompt(pass1: Pass1Result, pass2: Pass2Result, userPlan: string, notes: UserNote[] = [], highlights: PdfHighlight[] = []) {
  const annotationContext = {
    notes: notes.map((note) => ({ body: note.body, verification: note.verification })),
    highlights: highlights.map((highlight) => ({ page: highlight.pdfPageIndex, color: highlight.color, text: highlight.text ?? '', aiSummary: highlight.aiSummary ?? '', translation: highlight.translation ?? '' })),
  }
  return `執行第三遍虛擬重建與批判。這一遍只使用第一遍、第二遍、使用者筆記與螢光重點，不重新讀取或分析 PDF 全文；使用者筆記與螢光內容是閱讀方向與問題線索，不是未經證明的論文事實。逐步重建問題、資料處理、模型、loss、訓練、評估與超參數，逐項標 explicit／implicit／missing。檢查假設、baseline、ablation、統計可靠性、可重現性與威脅效度。提出 3–5 個可驗證研究題目，每題必須包含動機、假設、最小實驗、所需資料與驗證指標，且這些是 AI 建議，不是原文結論。不得宣稱已重新實作。每個需要原文支持的判斷，只能使用第一、二遍中已有的 evidenceIds。
第一、二遍資料：${wrapUntrusted('previous-analysis', JSON.stringify({ pass1, pass2 }))}
使用者筆記與螢光重點：${wrapUntrusted('user-annotations', JSON.stringify(annotationContext))}
使用者重建想法：${wrapUntrusted('user-reimplementation-plan', userPlan || '未提供')}`
}

export function tablePrompt(label: string, pageIndex: number, pageText: string) {
  return `只分析指定的 ${label || '表格'}（PDF page index ${pageIndex}）。輸出必須是單一 JSON object，禁止再包 result、data、tableAnalysis 或其他外層 key；不要輸出 Markdown 或說明文字。所有表格欄位都要存在：columns 是字串陣列，rows 是由 {"raw":字串,"emphasized":布林} 組成的二維陣列；沒有資料用空陣列，未知值用 null 或 schema 指定的明確缺值狀態。請先抽取 columns、rows 原始字串、可靠時的 emphasized 線索、footnotes 與 observations，再做三步分析：
Step A：僅指出「本文所報告的比較結果」與表內定位，不得稱全球 SOTA；區分本文方法、重現 baseline、引用前人數值。
Step B：只比較有報告的效能與成本欄位，百分比差異區分 percentage points 與 relative percent；缺值寫未報告。
Step C：檢查 split、pretraining、外部資料、硬體、統計與消融；最大下降只能稱「在所測設定中最敏感」，不得宣稱因果核心。每筆結果以 evidenceIds 連到 evidence，短摘錄需出自本頁。若頁面沒有可可靠抽取的表格，保留空的 columns／rows／observations，並在 limitations 說明需人工核對。
頁面文字：${wrapUntrusted('target-page-text', pageText)}`
}

export function roiPrompt(pageIndex: number, instruction: string) {
  return `分析 PDF page index ${pageIndex} 上使用者圈選的影像區域。${instruction || '辨識其 Figure/Table 標號、內容、主要數值與需要人工核對的限制。'} 不清楚的內容明確寫「無法辨識」，不得補造。以簡潔繁體中文回答。`
}
