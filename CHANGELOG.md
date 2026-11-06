# Changelog

## 0.2.0 — 2026-11-06

- 模型清單只顯示 API 實際回傳的 `gemma-4-26b-a4b-it` 與 `gpt-oss-120b`，並加入獨立的讀取清單、文字生成測試、儲存及紅色清除設定按鈕。
- Provider、Base URL、模型、API Key、代理設定、設定面板與標題列顯示狀態重新整理後保留；模型單次等待上限提高為 600 秒。
- PDF 原檔改存 IndexedDB，重新整理後自動恢復。
- 加入多色 PDF 螢光筆、單點標記與刪除模式，標記隨專案保存且不產生便條。
- 移除頁首 Phase 標籤，標題列可隱藏及恢復。
- 第二遍加入精簡／缺欄回應相容層，不再因可補足的空欄位直接捨棄整份分析。
- 第一至第三遍與表格分析全面採用缺欄相容處理；未回傳的區段保留空白／明確缺值，表格單元格與觀察值也接受精簡格式，不再顯示缺少欄位數量。

## 0.1.2 — 2026-11-06

- API Key 改為依 Provider 儲存在瀏覽器 localStorage，重新整理後自動帶回，並提供個別清除控制。
- ProjectBundle、IndexedDB、匯出、repository 與日誌仍不保存 API Key。
- 所有進行中工作改為全畫面半透明遮罩，中央即時顯示步驟、說明、等待時間與可用的取消動作。
- 新增 Key 保存、Provider 隔離、清除及損毀 localStorage 防護測試。

## 0.1.1 — 2026-11-06

- 修正第一遍在模型回傳精簡或巢狀 JSON 時，直接顯示完整 schema 驗證錯誤的問題。
- 加入 Pass 1 相容層，補齊 schema metadata、明確缺值、五個 C 與 Evidence 預設欄位後再驗證。
- 驗證失敗改為簡短可操作訊息，不再把內部 Zod issues 顯示在介面。
- 回歸測試增加至 12 項。

## 0.1.0 — 2026-11-06

### Phase 0

- 建立 React、TypeScript strict、Vite、PDF.js、Zod 與 GitHub Pages workflow。
- 完成 Google AI Studio 與 CGU LLM Gateway adapter、動態模型清單、取消、逾時、429／5xx 重試與 usage 顯示。
- Key 初版僅存記憶體；完成 PDF → structured JSON → schema validation 的端到端流程。

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
