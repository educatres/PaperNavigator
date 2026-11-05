# 資料結構

Schema version：`1.0`。

核心型別位於 `src/domain/types.ts`，Zod runtime validators 與提供給模型的 JSON Schema 位於 `src/domain/schemas.ts`。

## 來源與分析分離

- `Paper`：檔案 hash、書目 metadata、各閱讀階段、observations、evidence、table analyses、citations、notes 與 PDF highlights。
- `PdfHighlight`：paper／頁碼、0–1 正規化矩形座標、顏色與建立時間；不建立便條。
- `SourceEvidence`：`paperId`、0-based `pdfPageIndex`、1-based `pdfPageDisplay`、印刷頁、section、object type／label、短摘錄、核對狀態與備註。
- `MetricObservation`：方法來源、task、dataset／version、split、metric definition／direction、raw value、numeric value、unit、pretraining、hardware、protocol 與 evidence IDs。
- `Pass1Result`：metadata、研究問題、五個 C、貢獻、閱讀決策與 evidence。
- `Pass2Result`：方法流程、資料集、指標、圖表、主張、observations、references 與 evidence。
- `Pass3Result`：重建、假設、效度威脅、可重現性風險與研究題目。
- `TableAnalysis`：原始 cell、排版線索、footnotes、observations、三步分析與 evidence。
- `UserNote`：人工筆記與 checked／pending／concern 狀態，永不覆蓋 AI 原始輸出。

缺值用 `null` 或 status，不使用虛構的 `0`。所有數值保留 `rawValue`，只有可安全解析時才另存 `numericValue`。

## 遷移與秘密清洗

`migrateBundle` 為缺少的新陣列欄位（包含 highlights）補預設值。ProjectBundle 保存與匯出前會遞迴移除 `apiKey`、`token`、`File` 與 PDF `bytes` 欄位；PDF Blob 只走獨立的 IndexedDB store，不進 JSON 匯出。
