# PaperNavigator

PaperNavigator 是以「來源可追溯」為核心的 AI 論文快速閱讀導覽器。使用者上傳 PDF 後，可依 Keshav 三遍閱讀法逐步完成鳥瞰、方法與實驗理解、虛擬重建與批判；多篇論文則用明確的可比性規則整理 task、dataset、split、metric 與測試協議。

目前實作涵蓋規格的 Phase 0–4：

- PDF magic bytes、密碼／損毀處理、SHA-256 重複檢查、PDF.js 預覽與逐頁文字擷取。
- 第一遍五個 C、第二遍方法／圖表／觀測值、第三遍重建／假設／研究題目。
- 各分析階段接受精簡或部分 AI 回應；缺少區段保留空白／明確缺值，不會讓可用結果整份作廢。
- 第二遍 Figure／Table 索引與 PDF 來源定位。
- 每筆重要事實保留 evidence、PDF 實體頁、短摘錄與 matched／unverified／mismatch 狀態。
- 2–10 篇比較、可比性標籤、percentage points 與 relative % 分開計算。
- 可拖曳、縮放的浮動純文字筆記、IndexedDB 保存、Markdown／CSV／JSON／BibTeX／RIS 匯出與 JSON 回復。
- 第三遍會合併第一遍、第二遍、浮動筆記與螢光重點重新分析；格式不符時先交由格式化 LLM 修復 JSON。
- references 待驗證清單、Crossref DOI 核對與共引線索。
- PDF 原檔本機保存、重新整理自動恢復，以及可連續捲動、縮放與可選取文字的黃、綠、粉紅、淺藍螢光標記。
- PDF Viewer 在一般瀏覽模式可直接選取、複製原文；「圈選翻譯」與「圈選摘要」以灰色空心矩形框住文字區域，可連續建立多段後批次交給 AI。背景工作可隨時停止並保留已完成結果，再次執行會接續未完成段落。移入或點擊「文」／「摘」會開啟可任意拖曳、直到按 X 才關閉的譯文／摘要框；兩種標記會錯開排列，只有游標停在標記上時，來源區域才顯示灰色空心框。已完成的譯文與摘要可直接編輯、取消或儲存，並支援清除單段或同類全部結果。
- PDF Viewer 可隨時收合；「圈選截圖」工具會把拖曳範圍裁切並保存在「截圖」分頁，支援原頁定位與刪除。
- 第一遍與第二遍都會把完整 PDF（逐頁文字與頁碼標記）交給分析流程，不限於單一頁面。
- 每筆螢光標記可改色、刪除、產生 Markdown AI 摘要與翻譯，結果會保存在原文下方並可匯出。

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

介面支援兩種 provider，模型清單由 API 動態取得後，只顯示實際讀到的 `gpt-oss-120b` 與 `gemma-4-26b-a4b-it`；CGU 預設為 `gpt-oss-120b`：

| Provider | Base URL | PDF 資料流 | 生成 API |
| --- | --- | --- | --- |
| Google AI Studio | `https://generativelanguage.googleapis.com/v1beta` | PDF 以 `inlineData` 直接送往 Gemini | `models/:model:generateContent` + JSON Schema |
| CGU LLM Gateway | `https://air.cgu.edu.tw/cgullmapi/v1` | PDF.js 先在本機擷取逐頁文字；只傳文字 | 指定模型使用 `/responses` |

所有結構化分析都會附上完整 JSON Schema，目標格式為單一 JSON object。若模型仍加入 Markdown code fence、前後說明或尾逗號，系統會先在本機安全取出並修復 JSON，不額外呼叫 API；只有找不到 JSON、疑似截斷或無法通過正規化驗證時，才在初次請求後最多重做三次（最多四次 API 呼叫）。重做狀態會顯示在全螢幕遮罩，所有嘗試的 token 都會累計在 usage，並可能產生額外 API 費用。

Google API Key 以 `x-goog-api-key` header 傳送；CGU 使用 `Authorization: Bearer`。Key 會依 Provider 儲存在目前瀏覽器的 localStorage，重新整理後會自動帶回，直到使用者在設定面板按「清除」。Key 不會寫入 IndexedDB、URL、repo、專案資料、匯出或日誌；共用電腦請用完後清除。

純前端 BYOK 模式無法把 Key 當成伺服器秘密保護，適合研究原型與充分知情的使用者。機密或未公開 PDF 應先確認所選 AI 服務的使用條款與機構政策。

## GitHub Pages

Vite `base` 使用相對路徑，可部署在 repository 子路徑。Repository 的 **Settings → Pages → Build and deployment** 選擇 **GitHub Actions**，推送 `main` 後會執行測試、建置與部署。Workflow 位於 `.github/workflows/deploy-pages.yml`。

本專案不使用前端 router，因此 GitHub Pages 重新整理不需要額外 fallback 規則。

## 本機資料與備份

分析、筆記、螢光標記、PDF 截圖、圈選翻譯、圈選摘要、書目與 PDF 原檔存於 IndexedDB，重新整理後會自動恢復。完整專案 JSON 含 `schemaVersion`、螢光標記、截圖、圈選翻譯與圈選摘要，但仍不含 PDF 原檔或 Key。完整 A4 報告的最後一節會附上重點標記及其 AI 摘要／翻譯、截圖與筆記。API 單次等待上限為 600 秒。

進一步設計、測試與隱私說明位於 [docs](./docs)。
