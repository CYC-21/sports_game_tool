# 出門看球！觀賽行程規劃小幫手
### [🔗 直接前往小幫手 🔗](https://cyc-21.github.io/sports_game_tool/#/)

以「場館」為核心的觀賽行程工具：可依地區、運動、聯盟、時間查賽事，查看場館與附近景點，並提供賽事／景點投稿。

前端為靜態網站（GitHub Pages 可用），資料來源為 Google Sheets，透過 Apps Script Web App 提供 JSON API。

---

## 主要功能

- 首頁三模式：地點瀏覽、附近（定位）、時間軸
- 篩選條件：地區、運動、球場、聯盟、年/月、賽季、狀態、隊名搜尋
- 賽事詳情：對戰資訊、時間/狀態、場館、聯盟、直播連結
- 場館頁：地圖、附近景點（同城或距離範圍）、場館賽事
- 投稿：
  - 賽事投稿 -> `matches_pending`（待審）
  - 景點投稿 -> `places`（可直接新增；地圖連結解析不到座標時以「距離未知」顯示）

---

## 專案結構

```text
github/
├─ index.html
├─ css/
│  ├─ app.css
│  └─ fonts.css
├─ js/
│  ├─ app.js
│  ├─ api.js
│  ├─ config.js
│  ├─ enrich.js
│  ├─ gviz.js
│  └─ status.js
├─ apps-script/
│  ├─ Code.gs
│  └─ 部署說明.md
├─ 資料對齊說明.md
├─ 資料欄位規格.md
└─ 色票定義.md
```

---

## 快速開始（前端）

1. 調整 `js/config.js`：
   - `API_BASE`：填入你的 Apps Script `.../exec`
   - `SHEET_ID`：填入對應 Google Sheet ID
2. 將 `github/` 發佈到 GitHub Pages（或任一靜態主機）
3. 開啟網站測試首頁與詳情頁

---

## Apps Script / 資料來源

- 後端程式：`apps-script/Code.gs`
- 部署步驟：`apps-script/部署說明.md`
- API 範例：
  - `...?resource=help`
  - `...?resource=matches`
  - `...?resource=venues`
  - `...?resource=places`

`Code.gs` 使用快取（預設 10 分鐘），更新腳本後請記得「重新部署新版本」。

---

## 資料表與欄位

請先閱讀：

- `資料對齊說明.md`
- `資料欄位規格.md`

常用分頁：

- `matches`
- `matches_pending`
- `venues`
- `places`
- `teams`
- `leagues`
- `sports`
- `place_types`

---

## 維護備註

- 景點短網址（如 `maps.app.goo.gl`）在伺服器端可能無法穩定解析座標；系統允許先寫入，前端顯示「距離未知」。
- 若 `places` 有 `missing_coords` 欄位，後端會自動標記缺座標資料，便於後續人工補正。

---

## AI 協作聲明

本專案主要由 AI 輔助生成與迭代（包含前端、Apps Script、文件）。  
維護者已依實際需求進行調整與驗證，但仍可能存在未預期問題；若發現錯誤，歡迎提出 issue 或直接修正 PR。

---

## 授權

本專案原作者於頁面「關於」提及使用 GPL-3.0。若你要公開再散佈，建議補上正式 `LICENSE` 檔並確認授權聲明一致。

