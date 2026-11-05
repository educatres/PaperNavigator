# 隱私與安全

## API Key

- Key 只存在目前瀏覽器分頁的記憶體。
- 不寫入 localStorage、IndexedDB、URL、GitHub Actions、analytics、console 或任何匯出。
- Google 使用 `x-goog-api-key` header；CGU 使用 Bearer header。
- Project Proxy Token 同樣只存記憶體。
- 純前端 JavaScript 無法像後端秘密一樣保護使用者 Key；正式機構部署應使用後端代理與短效憑證。

## PDF

- PDF 在本機執行 magic bytes、SHA-256、PDF.js 解析與預覽。
- Google 模式在使用者按下分析後，將 PDF 傳至 Google Gemini。
- CGU 模式一般分析只傳 PDF.js 擷取文字；圈選區域分析會傳送該區 PNG。
- 本站儲存不含 PDF 原檔；重新載入後需重新附檔。
- PDF 文字、引用與圈選內容一律包成不可信資料。系統提示明確禁止接受文件內的 prompt injection。

## 輸出

- JSON 備份不含 Key、PDF bytes、File 或代理 Token。
- CSV 對 `=`, `+`, `-`, `@` 開頭的欄位加前置單引號，避免公式注入。
- 模型輸出以 React 純文字節點呈現，不注入 HTML。
- CSP 禁止 object、限制 script 為本站資源，並允許必要 HTTPS API 連線。

## 本機資料

分析與筆記存在 IndexedDB。清除瀏覽器資料會刪除結果；使用者應定期匯出 JSON 備份。跨裝置同步需另外部署 Project Proxy，並由部署者提供身分驗證、授權、加密、備份與資料保留政策。
