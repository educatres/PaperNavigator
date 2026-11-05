# Project Proxy 部署契約

`server/project-proxy.mjs` 提供最小的 GET／PUT 同步服務，資料以 JSON 檔原子寫入伺服器指定目錄。

## 啟動

PowerShell：

```powershell
$env:SYNC_TOKEN = '請使用長且隨機的部署密碼'
$env:APP_ORIGIN = 'http://localhost:5173'
$env:PORT = '8787'
npm.cmd run proxy:dev
```

前端進階設定填入 `http://localhost:8787` 與同一 Token。正式環境必須使用 HTTPS。

## HTTP 契約

- `PUT /projects/:id`：儲存 `ProjectBundle`。
- `GET /projects/:id`：讀取 `ProjectBundle`。
- `Authorization: Bearer <token>`。
- `Content-Type: application/json`。
- 最大 request body 10 MB；拒絕含 Key／Token 欄位的 bundle。

這個最小服務只證明代理與同步介面，適合單一研究者自架。正式多人部署需替換 Bearer 共用密碼、加入每位使用者的專案授權、TLS、at-rest encryption、稽核、刪除流程、備份及 rate limiting。
