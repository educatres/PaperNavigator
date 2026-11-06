# 規格追蹤摘要

| 規格 | 實作位置 |
| --- | --- |
| FR-01 PDF 與書架 | `src/pdf/pdfClient.ts`, `src/App.tsx` |
| FR-02 第一遍／五個 C | `src/ai/prompts/prompts.ts`, `Pass1View` |
| FR-03 第二遍 | `Pass2Result`, `Pass2View` |
| FR-04 Figure／Table 索引與 PDF 定位 | `Pass2View`, `PdfViewer` |
| FR-05 跨篇比較 | `src/domain/comparison.ts`, `CompareView` |
| FR-06 第三遍 | `Pass3Result`, `Pass3View`, `pass3Prompt`, `analyzePass3`（第一遍／第二遍／筆記／螢光重點，可重做；完整報告由分頁列在瀏覽器新分頁開啟） |
| FR-07 Evidence 與 PDF 導航 | `verifyEvidence`, `EvidenceButtons`, `PdfViewer` |
| FR-07a PDF 逐段翻譯 | `src/pdf/pdfParagraphs.ts`, `paragraphTranslationPrompt`, `PdfViewer` hover popover |
| FR-07b PDF 截圖與收合 | `src/pdf/pdfScreenshot.ts`, `PdfViewer`, `ScreenshotsView` |
| FR-08 筆記與輸出 | `src/storage/exports.ts`, `NotesView` |
| FR-09 Key／模型／成本 | `src/ai/providers/provider.ts`, settings panel |
| Phase 4 引用 | `src/research/citations.ts` |

產品刻意不宣稱：已驗證全球最新 SOTA、已執行重訓、已閱讀未上傳全文、已完成真正可重現性驗證、固定免費額度或前端 Key 具伺服器等級保密性。
