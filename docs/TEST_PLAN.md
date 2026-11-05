# 測試與驗收計畫

## 自動化

| 檢查 | 指令 | 目前狀態 |
| --- | --- | --- |
| TypeScript strict | `npm.cmd run typecheck` | 通過 |
| Unit tests | `npm.cmd test` | 10/10 通過 |
| Production build | `npm.cmd run build` | 通過 |
| Dependency audit | `npm.cmd audit --omit=dev` | 0 vulnerabilities |

單元測試涵蓋：90%→92% 的 percentage points／relative %、零基準、資料集不同比較阻擋、硬體差異降級、Pass 1 五個 C、Evidence 頁碼範圍、摘錄正規化核對與 CSV 公式注入。

## 人工驗收文件組

- A：正常文字 PDF，含 Methods、baseline、多個 Table 與 ablation。
- B：同任務但不同 dataset split 或 pretraining。
- C：低品質掃描／雙欄與圖表較多 PDF。
- D：密碼保護或損毀 PDF。

## 人工驗收步驟

1. 匯入 A，確認 magic bytes、頁數、預覽與文字品質提示。
2. 輸入測試 Key、取得模型清單；重整頁面確認 Key 消失。
3. 執行 Pass 1；檢查五個 C 都有 evidence 或「未找到」，點 evidence 跳 PDF。
4. 執行 Pass 2；確認 prior work 與 paper proposed 分開，缺值不是 0。
5. 指定一個表格；確認只稱本文所報告的比較結果，消融最大下降不被稱為因果證明。
6. 執行 Pass 3；確認 missing／implicit 可見，研究題目標示為 AI 建議。
7. 加入 B；不同 split 不得出現全體第一名。同條件資料顯示 absolute、relative 與 percentage points。
8. 以 C 驗證低文字品質警示與人工核對狀態；以 D 驗證拒絕原因。
9. 匯出 Markdown、CSV、JSON、BibTeX、RIS；搜尋輸出確認不含 Key 或 PDF bytes。
10. 重整後匯入 JSON，重新附上 A；確認 SHA-256 相符後恢復 PDF 導航。

真實 API 的 CORS、模型權限與額度取決於使用者帳號，必須使用該帳號的測試 Key 完成最終連線驗收；repository 與自動測試不保存真實 Key。
