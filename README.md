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
| Wayback Availability | レート制限時に **429 ではなく HTTP 200 + 空オブジェクト**を返す | CDX へ自動フォールバック |
| NDL WARP | 結果は JS 描画で HTML に無し。`/api/search` は CloudFront が 403 | スクレイプ断念、URL 生成のみ |
| Marginalia | 公式に英語専用。サービス移行中で HTML 構造が不安定 | スクレイプ断念、URL 生成のみ |

常に空を返すツールは、無いより有害なため作らない。

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
