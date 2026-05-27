# toban-yosui

東播用水ダム水位の自動監視・LINE 通知サービス。

## 背景

- 東播用水土地改良区が管理する **大川瀬ダム** と **呑吐ダム** の水位を自動取得し、農家（特に水利委員）に LINE で通知する
- ユーザー: 水稲栽培農家の水利委員（先輩農家）
- 現状の手動運用: toban-yosui.jp や電話で水位を確認 → 必要時に配水手配の電話

## データソース

| ソース | 用途 | 粒度 |
|--------|------|------|
| kawabou JSON API (`river.go.jp`) | メイン（貯水位・流入・放流） | 10分 |
| toban-yosui.jp HTML スクレイピング | 補完（貯水量・貯水率） | 日次 9時 |
| 気象庁アメダス | 相関分析 | 日次 |

### kawabou JSON エンドポイント
- 観測値時系列: `https://www.river.go.jp/kawabou/file/files/tmlist/dam/{YYYYMMDD}/{HHMM}/{obsCd}.json`
- ダム諸元: `https://www.river.go.jp/kawabou/file/files/master/obs/dam/{obsCd}.json`
- 最新時刻: `https://www.river.go.jp/kawabou/file/system/rwCrntTime.json`
- 観測所コード: 大川瀬ダム=`2206100700004`、呑吐ダム=`2206100700005`
- 過去データ保存期間は約1〜2週間（それ以前は HTTP 404）

### kawabou Ccd 値の意味
- `0` または `140`: 正常値
- `160`: データなし（kawabou が未対応の項目。貯水量・貯水率は現在 `160`、改修中）

## 技術スタック

- **Frontend/API**: Next.js 15.5 + TypeScript + Tailwind CSS 4 + App Router
- **ORM**: Prisma 6 + PostgreSQL 16
- **Scraper**: Python 3.14 + uv（`scrapers/` 配下）
- **デプロイ**: Vercel Hobby + Supabase Free + GitHub Actions cron
- **通知**: LINE Messaging API（無料枠 月200通）

## ローカル開発

```bash
make db-up       # PostgreSQL 起動
make migrate     # スキーマ適用
make seed        # 大川瀬・呑吐の諸元を投入
make scrape-kawabou  # kawabou JSON を取得
make dev         # Next.js dev サーバー
```

## ディレクトリ構成

```
toban-yosui/
├── src/app/          # Next.js App Router
├── prisma/           # スキーマ・マイグレーション
├── scrapers/         # Python スクレイパー（kawabou/toban/weather）
├── docker-compose.yml
├── Makefile
└── .env.example
```

## 設計原則

- **テーブル名は一般化**（`dam` / `observation` / `weather_daily`）：将来 AGRISAT に吸収するための準備
- **緯度経度を持つ**：将来の PostGIS 化に備える
- **rawJson / rawHtml を保持**：パース失敗時の手戻り用
- **マルチテナント・認証は今やらない**（YAGNI、当面は水利委員1人）

## 将来パス

- Phase 2: 配水台帳の LINE Bot 化（「○○池に○日まで水入れて」の記録）
- Phase 3: 溜池 IoT 水位センサー連携（ESP32 + 投げ込み式センサー + LTE-M）
- Phase 4: AGRISAT 水管理モジュールとして吸収
