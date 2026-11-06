# 測試與驗收計畫

## 自動化

| 檢查 | 指令 | 目前狀態 |
| --- | --- | --- |
| TypeScript strict | `npm.cmd run typecheck` | 通過 |
| Unit tests | `npm.cmd test` | 33/33 通過 |
| Production build | `npm.cmd run build` | 通過 |
| Dependency audit | `npm.cmd audit --omit=dev` | 0 vulnerabilities |

單元測試涵蓋：90%→92% 的 percentage points／relative %、零基準、資料集不同比較阻擋、硬體差異降級、Pass 1 五個 C、Pass 2 精簡回應相容、Pass 3 與表格部分回應相容、所有分析階段缺少區段、嚴格單一 JSON object、三次格式重做上限、網路／權限錯誤不誤重試、重做 token 累計、固定 Schema 契約、Evidence 頁碼範圍、摘錄正規化核對、CSV 公式注入、完整 Provider 設定保存／清除，以及舊專案 highlight 遷移。

## 人工驗收文件組

- A：正常文字 PDF，含 Methods、baseline、多個 Table 與 ablation。
- B：同任務但不同 dataset split 或 pretraining。
- C：低品質掃描／雙欄與圖表較多 PDF。
- D：密碼保護或損毀 PDF。

## 人工驗收步驟

1. 匯入 A，確認 magic bytes、頁數、預覽與文字品質提示。
2. 輸入測試 Key，按「讀取模型清單」確認只出現 API 實際回傳的 Gemma／OSS 120B；執行「測試連線」確認明確顯示「測試成功」及模型回覆，再驗證儲存、重整保留與紅色清除功能。
3. 執行 Pass 1；確認全畫面半透明遮罩顯示目前步驟、等待時間與取消按鈕，再檢查五個 C 都有 evidence 或「未找到」，點 evidence 跳 PDF。
4. 執行 Pass 2；確認 prior work 與 paper proposed 分開，缺值不是 0，且精簡回應的缺少欄位會補明確預設而非整份作廢。
5. 指定一個表格；確認只稱本文所報告的比較結果，消融最大下降不被稱為因果證明；AI 省略任一欄位時仍保留其餘可用結果，不顯示「等 N 個欄位」。
6. 執行 Pass 3；確認 missing／implicit 可見，研究題目標示為 AI 建議。
7. 加入 B；不同 split 不得出現全體第一名。同條件資料顯示 absolute、relative 與 percentage points。
8. 以 C 驗證低文字品質警示與人工核對狀態；以 D 驗證拒絕原因。
9. 匯出 Markdown、CSV、JSON、BibTeX、RIS；搜尋輸出確認不含 Key 或 PDF bytes。
10. 在 PDF 上拖曳螢光標記並點一下新增標記點，重整後確認 PDF 原檔及標記都自動恢復；切換刪除模式確認可移除且不產生便條。
11. 以測試模型故意回傳非 JSON、Markdown code fence 或 schema 不符內容；確認遮罩依序顯示第 2/3、3/3 次重做，成功後保留累計 usage，三次皆失敗時保留原有分析。

真實 API 的 CORS、模型權限與額度取決於使用者帳號，必須使用該帳號的測試 Key 完成最終連線驗收；repository 與自動測試不保存真實 Key。
