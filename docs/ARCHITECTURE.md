# 架構與資料流

## 分層

```text
React UI
  ├─ PDF Viewer / ROI
  ├─ Reading passes / Table analysis / Compare
  └─ Notes / Citation / Export / Sync
          ↓
Analysis Orchestrator
  ├─ Prompt version
  ├─ AIProvider adapter
  ├─ Zod schema validation
  └─ Evidence verification
          ↓
Google generateContent       CGU Responses / Chat Completions
          ↓                              ↓
PDF inlineData                  PDF.js extracted page text

IndexedDB ← ProjectBundle → JSON / Markdown / CSV / BibTeX / RIS
                            → optional Project Proxy
```

UI 不直接組 API payload；`src/ai/orchestrator` 選擇 prompt 與 schema，`src/ai/providers` 處理傳輸、錯誤、重試與 usage。比較與差異計算位於純函式，AI 不負責做百分比心算。

## 分階段分析

1. PDF.js 驗證檔案、取得頁數、逐頁文字與 SHA-256。
2. Pass 1 只產生鳥瞰與五個 C。
3. 使用者明確選擇後才執行 Pass 2；產生方法、圖表索引、evidence、observations 與 references。
4. 指定表格可單獨重做，不需重做整篇分析。
5. Pass 3 只在 Pass 2 後執行；輸出重建狀態、假設、威脅與可驗證研究題目。
6. 比較工作台只使用已保存的 observations；篩選不觸發 AI。

## Provider 差異

Google 模式保留 PDF 的視覺、版面與圖表資訊，使用原生 `generateContent` 的 `inlineData` 與 `responseJsonSchema`。CGU Gateway 提供 OpenAI-compatible 文字／視覺端點，因此一般整篇分析先由 PDF.js 抽取帶頁碼文字；圈選圖表時才傳送 PNG data URL。這個差異會影響掃描 PDF 的品質，UI 會顯示本機文字不足警示。

## 快取與檔案生命週期

`ProjectBundle` 保存分析，不保存 `File`、PDF bytes 或 API Key。重新載入後，使用者需重新選取同一 PDF；SHA-256 相符才重新綁定。這能避免 IndexedDB 長期留存原始論文，也讓 Key 不進入任何序列化路徑。
