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
- CGU 模式一般分析只傳 PDF.js 擷取文字；圈選區域分析會傳送該區 PNG。
- PDF 原檔與解析 metadata 保存在本站來源的 IndexedDB，重新整理後自動恢復；清除本機專案或瀏覽器網站資料會刪除原檔。
- PDF 文字、引用與圈選內容一律包成不可信資料。系統提示明確禁止接受文件內的 prompt injection。

## 輸出

- JSON 備份不含 Key、PDF bytes 或 File。
- CSV 對 `=`, `+`, `-`, `@` 開頭的欄位加前置單引號，避免公式注入。
- 模型輸出以 React 純文字節點呈現，不注入 HTML。
- CSP 禁止 object、限制 script 為本站資源，並允許必要 HTTPS API 連線。

## 本機資料

分析、筆記、螢光標記與 PDF 原檔存在 IndexedDB。清除瀏覽器資料會刪除結果及原檔；JSON 備份不含 PDF，因此使用者仍應自行保存原始論文。
