# Changelog

## 0.1.1 — 2026-11-06

- 修正第一遍在模型回傳精簡或巢狀 JSON 時，直接顯示完整 schema 驗證錯誤的問題。
- 加入 Pass 1 相容層，補齊 schema metadata、明確缺值、五個 C 與 Evidence 預設欄位後再驗證。
- 驗證失敗改為簡短可操作訊息，不再把內部 Zod issues 顯示在介面。
- 回歸測試增加至 12 項。

## 0.1.0 — 2026-11-06

### Phase 0

- 建立 React、TypeScript strict、Vite、PDF.js、Zod 與 GitHub Pages workflow。
- 完成 Google AI Studio 與 CGU LLM Gateway adapter、動態模型清單、取消、逾時、429／5xx 重試與 usage 顯示。
- Key 僅存記憶體；完成 PDF → structured JSON → schema validation 的端到端流程。

### Phase 1

- 完成書架、第一遍、第二遍、表格三步分析、證據跳頁、筆記、Markdown 與 JSON 匯出。

### Phase 2

- 完成多篇管理、觀測值正規化、可比性規則、比較矩陣、差異計算與 CSV 安全匯出。

### Phase 3

- 完成第三遍重建、假設／效度／可重現性檢核、研究題目與使用者重建筆記。

### Phase 4

- 完成 PDF 區域圈選、references 管理、Crossref DOI 核對、共引線索、BibTeX／RIS、Web Share 與可插拔 Project Proxy。

### 驗證

- TypeScript typecheck、production build 與 10 個單元測試通過。
- npm production dependency audit：0 vulnerabilities。
