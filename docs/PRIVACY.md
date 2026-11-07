# 隱私與安全

## API Key

- Key 依 Provider 儲存在目前瀏覽器的 localStorage，重新整理後會自動帶回，直到使用者按「清除」。
- 不寫入 IndexedDB、URL、GitHub Actions、analytics、console、專案資料、repository 或任何匯出。
- Google 使用 `x-goog-api-key` header；CGU 使用 Bearer header。
- localStorage 不會加密，也可能被同來源 JavaScript 讀取；共用或公共電腦使用後必須清除。
- 純前端 JavaScript 無法像伺服器秘密一樣保護使用者 Key；只適合充分知情的 BYOK 使用情境。

## PDF

- PDF 在本機執行 magic bytes、SHA-256、PDF.js 解析與預覽。
- Google 模式在使用者按下分析後，將 PDF 傳至 Google Gemini。
- CGU 模式一般分析只傳 PDF.js 擷取文字；螢光標記的摘要或翻譯只傳送使用者選取的文字。
- 螢光標記的 AI 摘要與翻譯只會傳送該筆使用者選取的文字，不會重新上傳整份 PDF。
- 執行 PDF Viewer 的圈選翻譯時，只會由可取消的背景工作逐筆傳送使用者圈選的文字至所選 AI Provider；不會為此功能重新上傳 PDF 檔案。停止後只保留已完成回應，尚未完成的段落只保留本機待翻譯標記，不會保存半成品。
- PDF 圈選截圖完全在瀏覽器本機由已渲染 canvas 裁切，不會傳送到 AI Provider；截圖會進入 IndexedDB、專案 JSON 備份與完整報告。
- 執行第三遍時會把浮動純文字筆記與螢光重點送至所選 AI Provider，作為重建與批判的閱讀線索。
- PDF 原檔與解析 metadata 保存在本站來源的 IndexedDB，重新整理後自動恢復；清除本機專案或瀏覽器網站資料會刪除原檔。
- PDF 文字、引用與螢光標記內容一律包成不可信資料。系統提示明確禁止接受文件內的 prompt injection。

## 輸出

- JSON 備份不含 Key、PDF bytes 或 File。
- CSV 對 `=`, `+`, `-`, `@` 開頭的欄位加前置單引號，避免公式注入。
- 模型輸出以 React 純文字節點呈現，不注入 HTML。
- CSP 禁止 object、限制 script 為本站資源，並允許必要 HTTPS API 連線。

## 本機資料

分析、浮動筆記、螢光標記、PDF 截圖、圈選翻譯與 PDF 原檔存在 IndexedDB。清除瀏覽器資料會刪除結果及原檔；JSON 備份不含 PDF，但會包含截圖，因此使用者仍應自行保存原始論文並留意備份檔案大小。
