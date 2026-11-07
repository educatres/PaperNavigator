# 資料結構

Schema version：`1.0`。

核心型別位於 `src/domain/types.ts`，Zod runtime validators 與提供給模型的 JSON Schema 位於 `src/domain/schemas.ts`。

## 來源與分析分離

- `Paper`：檔案 hash、書目 metadata、各閱讀階段、observations、evidence、舊版 table analyses、citations、浮動純文字筆記 `floatingNote`、PDF highlights、`screenshots`、`pdfTranslations` 與 `pdfAreaSummaries`。舊版 `notes`、`aiRegionSummaries` 僅保留資料相容性；新版圈選摘要使用完整來源文字與座標的 `pdfAreaSummaries`。
- `PdfHighlight`：paper／頁碼、0–1 正規化矩形座標、顏色、可選取文字、AI 摘要、翻譯與建立時間；同次選取只保存第一個版面區塊，舊資料仍可讀取 `rects`。
- `PdfParagraphTranslation`：paper／頁碼／段落順序、來源文字與來源識別、0–1 正規化來源區域座標（沿用 `lines` 欄位以相容舊資料）、繁體中文譯文、模型、建立時間與可選的 `origin`（`auto`／`selection`）。目前介面只新增及顯示 `selection` 區域圈選翻譯，可先以空譯文保存為待翻譯註釋；`auto` 僅保留舊專案資料相容性。
- `PdfAreaSummary`：與圈選翻譯相同的 paper／頁碼／順序／來源文字／來源識別／正規化區域座標，另保存繁體中文 AI 摘要、模型與建立時間；空摘要代表等待批次處理。
- `PdfScreenshot`：paper／頁碼、0–1 正規化圈選矩形、WebP／PNG data URL 與建立時間；截圖只包含 PDF canvas，不包含螢光標記或翻譯浮窗。
- `SourceEvidence`：`paperId`、0-based `pdfPageIndex`、1-based `pdfPageDisplay`、印刷頁、section、object type／label、短摘錄、核對狀態與備註。
- `MetricObservation`：方法來源、task、dataset／version、split、metric definition／direction、raw value、numeric value、unit、pretraining、hardware、protocol 與 evidence IDs。
- `Pass1Result`：metadata、研究問題、五個 C、貢獻、閱讀決策與 evidence。
- `Pass2Result`：方法流程、資料集、指標、圖表、主張、observations、references 與 evidence。
- `Pass3Result`：重建、假設、效度威脅、可重現性風險與研究題目。
- `TableAnalysis`：原始 cell、排版線索、footnotes、observations、三步分析與 evidence。
- `UserNote`：舊版人工筆記相容型別；新版介面以 `Paper.floatingNote` 保存單一純文字筆記。

缺值用 `null` 或 status，不使用虛構的 `0`。所有數值保留 `rawValue`，只有可安全解析時才另存 `numericValue`。

## 遷移與秘密清洗

`migrateBundle` 為缺少的新陣列欄位（包含 highlights、screenshots、pdfTranslations 與 pdfAreaSummaries）補預設值。ProjectBundle 保存與匯出前會遞迴移除 `apiKey`、`token`、`File` 與 PDF `bytes` 欄位；PDF Blob 只走獨立的 IndexedDB store，不進 JSON 匯出。
