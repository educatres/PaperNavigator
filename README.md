# PaperNavigator

PaperNavigator 是以「來源可追溯」為核心的 AI 論文快速閱讀導覽器。使用者上傳 PDF 後，可依 Keshav 三遍閱讀法逐步完成鳥瞰、方法與實驗理解、虛擬重建與批判；多篇論文則用明確的可比性規則整理 task、dataset、split、metric 與測試協議。

目前實作涵蓋規格的 Phase 0–4：

- PDF magic bytes、密碼／損毀處理、SHA-256 重複檢查、PDF.js 預覽與逐頁文字擷取。
- 第一遍五個 C、第二遍方法／圖表／觀測值、第三遍重建／假設／研究題目。
- 各分析階段接受精簡或部分 AI 回應；缺少區段保留空白／明確缺值，不會讓可用結果整份作廢。
- 指定 Table/Figure 的 SOTA 定位、trade-offs、limitations／ablation 三步分析。
- 每筆重要事實保留 evidence、PDF 實體頁、短摘錄與 matched／unverified／mismatch 狀態。
- 2–10 篇比較、可比性標籤、percentage points 與 relative % 分開計算。
- 個人筆記、IndexedDB 保存、Markdown／CSV／JSON／BibTeX／RIS 匯出與 JSON 回復。
- references 待驗證清單、Crossref DOI 核對、共引線索與 PDF 區域圈選分析。
- PDF 原檔本機保存、重新整理自動恢復，以及不產生便條的多色螢光標記。

## 本機執行

需要 Node.js 22 或更新版本。

```powershell
npm.cmd install
npm.cmd run dev
```

驗證與正式建置：

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
```

## API 連線

介面支援兩種 provider，模型清單由 API 動態取得後，只顯示實際讀到的 `gemma-4-26b-a4b-it` 與 `gpt-oss-120b`；預設為 `gemma-4-26b-a4b-it`：

| Provider | Base URL | PDF 資料流 | 生成 API |
| --- | --- | --- | --- |
| Google AI Studio | `https://generativelanguage.googleapis.com/v1beta` | PDF 以 `inlineData` 直接送往 Gemini | `models/:model:generateContent` + JSON Schema |
| CGU LLM Gateway | `https://air.cgu.edu.tw/cgullmapi/v1` | PDF.js 先在本機擷取逐頁文字；只傳文字 | 指定模型使用 `/responses` |

所有結構化分析都會附上完整 JSON Schema，且只接受單一 JSON object；Markdown code fence、前後說明、陣列或無法通過正規化驗證的內容都會要求模型整份重做。初次請求後最多重做三次（最多四次 API 呼叫）；重做狀態會顯示在全螢幕遮罩，所有嘗試的 token 都會累計在 usage，並可能產生額外 API 費用。

Google API Key 以 `x-goog-api-key` header 傳送；CGU 使用 `Authorization: Bearer`。Key 會依 Provider 儲存在目前瀏覽器的 localStorage，重新整理後會自動帶回，直到使用者在設定面板按「清除」。Key 不會寫入 IndexedDB、URL、repo、專案資料、匯出或日誌；共用電腦請用完後清除。

純前端 BYOK 模式無法把 Key 當成伺服器秘密保護，適合研究原型與充分知情的使用者。機密或未公開 PDF 應先確認所選 AI 服務的使用條款與機構政策。

## GitHub Pages

Vite `base` 使用相對路徑，可部署在 repository 子路徑。Repository 的 **Settings → Pages → Build and deployment** 選擇 **GitHub Actions**，推送 `main` 後會執行測試、建置與部署。Workflow 位於 `.github/workflows/deploy-pages.yml`。

本專案不使用前端 router，因此 GitHub Pages 重新整理不需要額外 fallback 規則。

## 本機資料與備份

分析、筆記、螢光標記、書目與 PDF 原檔存於 IndexedDB，重新整理後會自動恢復。完整專案 JSON 含 `schemaVersion` 與螢光標記，但為控制檔案大小仍不含 PDF 原檔或 Key。API 單次等待上限為 600 秒。

進一步設計、測試與隱私說明位於 [docs](./docs)。
