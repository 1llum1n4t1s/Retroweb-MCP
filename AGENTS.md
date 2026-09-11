# Retroweb-MCP 作業規約

このファイルはリポジトリ全体に適用する。システム構造と設計判断は [DESIGN.md](DESIGN.md)、利用者向けの導入・使い方は [README.md](README.md) を正本とする。

## 環境と構成

- Node.js 20 以上と pnpm 11 を使い、依存関係は `pnpm-lock.yaml` に固定する。
- `src/index.ts` は stdio MCP サーバーと公開ツールのスキーマを定義する。外部サービス連携とドメイン知識は `src/` の各モジュールへ置く。
- `src/unit.ts` は外部ネットワーク不要の回帰確認、`src/smoke.ts` は関数・外部 API の実地確認、`src/e2e.ts` はビルド済みサーバーの MCP 結合確認を担う。
- `dist/` と `node_modules/` は生成物である。ソースとして編集せず、必要なときに build または install で再生成する。
- npm パッケージには `dist/`、`skills/`、`LICENSE`、`README.md` が含まれる。公開ツールの手順を変えたときは `skills/retroweb/SKILL.md` も同じ契約へ更新する。

## 実装規約

- MCP ツールを追加・改名・削除するときは、`src/index.ts` の登録、`src/e2e.ts` の期待ツール一覧、README のツール表、同梱 Skill を同じ変更で同期する。
- package version を変更するときは、`package.json` と `src/index.ts` のサーバー version を一致させる。
- stdio は MCP プロトコル専用に保つ。診断出力が必要な場合は stderr を使い、stdout へ任意のログを出さない。
- 外部 HTTP 通信は `src/http.ts` の timeout、retry、文字コード判定を再利用する。Internet Archive の Availability API が空応答を返す場合は、CDX フォールバックを維持する。
- `discover_sites` が索引を全走査していない場合は、`coverage.sampled` と走査範囲を結果に残す。`latestFirstSeen` を最新キャプチャや最終更新時刻として扱わない。
- WARP と Marginalia は検索 URL の生成だけを担う。Wiby は英語圏の現存ページ向けで、1 回 12 件・ページングなしの制約を維持する。
- README は利用者向けのインストール、ツール、使い方、制約を扱う。内部構造や変更時の手順はこのファイルまたは DESIGN.md に記載する。

## 必須コマンド

依存関係を復元するときは lockfile を変更しない形で実行する。

```powershell
pnpm install --frozen-lockfile
```

ソースまたは設定を変更したときの基本検証:

```powershell
pnpm unit
pnpm lint
pnpm build
```

外部 API、探索ロジック、文字コード処理を変更したときは、実ネットワークを使う検証も実行する。

```powershell
pnpm smoke
pnpm e2e
```

外部サービスのレート制限による失敗は、実装不具合と切り分けて記録する。仕上げに `git diff --check` を実行し、対象外の差分を commit に含めない。

## npm 公開

- `.github/workflows/npm-publish.yml` は `release/x.y.z` への push または手動実行で、public package `@kagayoi/retroweb-mcp` を公開する。
- release ブランチ名の `x.y.z` と `package.json` の version を一致させる。
- 公開認証はnpm Trusted PublishingとGitHub OIDCを使う。長期npmトークンをGitHub Secret、ファイル、ログ、commitに含めない。
