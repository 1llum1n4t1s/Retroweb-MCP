# Retroweb MCP

90 年代〜2000 年代前半の**日本語の個人サイト**を Web アーカイブから発掘するための MCP サーバ。

Google をはじめとする現行の検索エンジンは、この年代の個人サイトをほとんど索引していない。
本サーバは検索を強化するのではなく、**当時の発見経路（ディレクトリ・リンク集・Web リング）を
アーカイブ上で再生する**ことで、検索エンジンに一切載っていないページへ到達する。

## 何ができるか（実測）

`discover_sites` にジオシティーズのエリアを 1 つ渡すと、**148 件の個人サイト**が出る。
実際に発掘できた例:

| サイト | 内容 |
| --- | --- |
| 陽光の円舞曲 | アンジェリーク二次創作。キリ番 12345、since 1999 |
| ‐せんちめんたる‐ | 詩サイト。"Sorry! This page is Japanese only!"、3000HIT |
| 大濠高校模型同好会 | 高校の同好会。"Internet Explorer、800*600以上推奨" |

いずれも現行の検索エンジンでは到達できない。さらに各サイトの外部リンクを辿ると、
`village.infoweb.ne.jp/~sinobi/` `www.sol.dti.ne.jp/~m-otsuka/` といった別ホストへ芋づる式に広がる。

## ツール

| ツール | 用途 |
| --- | --- |
| `discover_sites` | **主力**。ホスト配下に存在した個人サイトをユーザー単位で列挙する |
| `wayback_cdx_search` | アーカイブ済み URL をファイル単位で列挙する |
| `wayback_snapshot` | 指定時点に最も近いスナップショットを解決する |
| `wayback_fetch_page` | 保存済みページ本文を取得（Shift_JIS / EUC-JP 自動判別） |
| `wayback_outlinks` | ページから外部リンクを抽出（芋づる発掘の中核） |
| `legacy_hosts` | 当時のホスティング・ISP・ランキングサイトの辞書（44 件） |
| `build_retro_queries` | `site:` 絞り込みと当時の言い回しによる検索クエリ生成 |
| `retro_search_strategy` | 探索手順そのものを返す。迷ったら最初に呼ぶ |
| `warp_search_url` | 国立国会図書館 WARP の検索 URL 生成（取得は不可、後述） |
| `marginalia_search_url` | Marginalia の検索 URL 生成（英語専用、後述） |

## 設計上の判断

**動かないものは実装しない**方針を取っている。以下は実 API を叩いて確認した結果。

| 対象 | 実測結果 | 判断 |
| --- | --- | --- |
| Wayback CDX | 正常動作 | 主力に採用 |
| Wayback CDX（ホスト全体の prefix 検索） | `limit` 付きの素のクエリは索引を端から舐めるため **60 秒で 504** | ページ分割 API（`showNumPages` / `page=`）へ切り替え |
| Wayback Availability | レート制限時に **429 ではなく HTTP 200 + 空オブジェクト**を返す | CDX へ自動フォールバック |
| 現行検索の `site:` 絞り込み | 当時のホストは索引から消えており、検索側が絞り込みを緩めて**生きているショッピングサイト**を返す（`site:geocities.co.jp` → Yahoo!ショッピング） | 終了済みホストのみ使用＋商業ドメインを `-site:` で除外 |
| NDL WARP | 結果は JS 描画で HTML に無し。`/api/search` は CloudFront が 403 | スクレイプ断念、URL 生成のみ |
| Marginalia | 公式に英語専用。サービス移行中で HTML 構造が不安定 | スクレイプ断念、URL 生成のみ |

常に空を返すツールは、無いより有害なため作らない。

### 広い指定でも落とさない（CDX ページ分割 API）

`discover_sites` に `www.geocities.co.jp` のようなホスト名だけを渡すと、CDX は索引の
先頭から該当行を探し続け、Internet Archive 側の nginx が 60 秒で 504 を返す。
`limit` を下げても始点が変わらないので解決しない。

そこで**総ブロック数を先に取り**（`showNumPages`、実測 3.5 秒で `23001`）、
`page=` を付けて 1 ブロックずつ読む。1 リクエストの処理量が索引 1 区画に限定されるため、
対象がどれだけ広くても 1〜2 秒で返る。

ブロックは URL キー順に並ぶので、先頭から順に読むと辞書順で先頭のエリアに偏る。
**範囲全体へ等間隔にブロックを散らし、件数の予算も各ブロックへ均等に配る**。
結果はホスト全体からの**標本**になるため、`coverage.sampled` で網羅でないことを明示する。

実測（`www.geocities.co.jp`、1997〜2002）: 23001 ブロック中 12 ブロックを読み、
**12 エリアにまたがる 226 サイトを 6 秒**で列挙。

### `site:` 検索が商業サイトへ流れる問題

ジオシティーズ本体が現行検索の索引から消えた結果、`site:geocities.co.jp` を投げると
検索エンジンが絞り込みを緩め、生きている `shopping.geocities.jp`（Yahoo!ショッピング）
ばかりを返す。ドメイン指定を直すだけでは閉じないので、二重に対処している。

1. ホスト辞書の各エントリに `searchIndex`（`retro` / `modern`）を持たせ、
   **現在も事業サイトが動いているドメインは既定のクエリから外す**（44 件中 13 件）。
   `build_retro_queries` の `includeModernHosts: true` で戻せる。
2. 全クエリの末尾に `-site:shopping.geocities.jp` など商業ドメインの除外句を付ける。

なおこの経路自体の期待値は低い。当時のホストはほぼ索引から消えているため、
実際に届くのは `discover_sites` → `wayback_outlinks` の芋づるのほう。

### 文字コード

当時の日本語ページは Shift_JIS / EUC-JP が主流で、`meta charset` を持たないものも多い
（1997 年の Yahoo! JAPAN トップは meta 無し）。`res.text()` は UTF-8 決め打ちのため
そのままでは全文が化ける。本サーバはヘッダ → meta → **バイト分布からの推定**の順で判定する。

## セットアップ

```bash
pnpm install && pnpm build
```

Claude Code への登録:

```bash
claude mcp add retroweb -- node C:/Users/IMT/dev/Retroweb-MCP/dist/index.js
```

`skills/retroweb/SKILL.md` に探索手順の Skill を同梱している。

## 検証

```bash
pnpm smoke
```

各外部 API を 1 回ずつ実際に叩いて件数を出す。外部サービスの仕様変更で
ツールが黙って空を返すようになったことを検知するためのもの。

```bash
pnpm e2e
```

MCP プロトコル越しにサーバを起動し、ツール登録・実地の発掘・エラー処理を通しで確認する。

いずれも**実ネットワークに接続する**ため、Internet Archive のレート制限で
一時的に失敗することがある。連続失敗する場合は時間を置いて再実行する。

## ライセンス

MIT
