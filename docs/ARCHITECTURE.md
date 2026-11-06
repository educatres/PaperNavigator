# 架構與資料流

## 分層

```text
React UI
  ├─ PDF Viewer / continuous pages / zoom / collapsible panel / text selection / persistent highlights / crop screenshots / translation popovers
  ├─ Reading passes / Compare
  └─ Floating note / Highlights / Citation / Export
          ↓
Analysis Orchestrator
  ├─ Prompt version
  ├─ AIProvider adapter
  ├─ JSON recovery + Zod schema validation
  ├─ format retry / format-only repair（先依原始輸出格式化，再最多重做三次）
  └─ Evidence verification
          ↓
Google generateContent       CGU Responses / Chat Completions
          ↓                              ↓
PDF inlineData                  PDF.js extracted page text

IndexedDB ← ProjectBundle + PDF Blob → JSON / Markdown / CSV / BibTeX / RIS
```

UI 不直接組 API payload；`src/ai/orchestrator` 選擇 prompt 與 schema，先修復常見的模型包裝格式；若仍無法驗證，會把原始輸出交給一次格式化 LLM，再於仍失敗時最多重新要求三次；`src/ai/providers` 處理傳輸、錯誤、網路重試與 usage。格式重做與網路重試分開處理，權限、連線或取消錯誤不會被誤判為 JSON 格式問題。比較與差異計算位於純函式，AI 不負責做百分比心算。

## 分階段分析

1. PDF.js 驗證檔案、取得頁數、完整逐頁文字與 SHA-256；第一遍／第二遍的文字型 Provider 送出全部頁面與頁碼標記。
2. Pass 1 只產生鳥瞰與五個 C。
3. 使用者明確選擇後才執行 Pass 2；產生方法、圖表索引、evidence、observations 與 references。
4. Pass 3 只在 Pass 2 後執行；輸出重建狀態、假設、威脅與可驗證研究題目。
5. PDF 檢視器連續渲染所有頁面，捲動時更新目前頁碼；同次文字選取只保存一筆螢光記錄與第一個版面區塊。
6. 第三遍只使用第一遍、第二遍、浮動純文字筆記與螢光重點，不重新傳送 PDF 全文；使用者可隨筆記或標記更新再次執行。
7. PDF Viewer 的逐段翻譯先由 PDF.js 依頁面、欄位與行距重建段落，再逐筆傳送段落文字；譯文與正規化行座標會立即保存，hover 浮窗固定顯示在原文上方。
8. 圈選截圖只裁切目前已渲染的 PDF canvas，不經 AI；以 WebP（不支援時 PNG）data URL 與正規化來源座標保存，並可隨專案備份及完整報告移動。
9. 比較工作台只使用已保存的 observations；篩選不觸發 AI。

## Provider 差異

Google 模式保留 PDF 的視覺、版面與圖表資訊，使用原生 `generateContent` 的 `inlineData` 與 `responseJsonSchema`。CGU Gateway 提供 OpenAI-compatible 文字端點，一般分析由 PDF.js 抽取帶頁碼文字；文字標記、摘要與翻譯會保存到「重點標記」。

## 快取與檔案生命週期

`ProjectBundle` 保存分析、正規化頁面座標的螢光標記、截圖與逐段翻譯，不內嵌 `File`、PDF bytes 或 API Key。PDF 原檔另存於 IndexedDB `pdfs` object store，重新載入時以 paper ID 自動恢復；若網站資料被清除，仍可用 SHA-256 相符的原檔重新綁定。API Key 與 Provider、Base URL、模型則保存在 localStorage，與 ProjectBundle、匯出及 repository 隔離。
