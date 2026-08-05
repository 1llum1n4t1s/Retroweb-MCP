---
name: retroweb
description: 90年代〜2000年代前半の日本語個人サイトなど、Google に載っていない古いマイナーなページを Web アーカイブから発掘する手順。Use when the user asks to find old Japanese personal websites, 90年代のサイト, 昔のホームページ, 消えたサイト, ジオシティーズ, 閉鎖したサイト, or wants to search for pages that current search engines no longer index.
---

# レトロサイト発掘の手順

## 前提となる考え方

90 年代の個人サイトは **「検索」ではなく「ディレクトリとリンク集と Web リング」で発見される設計**だった。
現代の検索エンジンを工夫しても届かないのは、索引が存在しないからで、クエリの問題ではない。

したがって取るべき戦略は 1 つ: **当時の発見経路をアーカイブ上で再生する**。

Retroweb MCP のツールはこの経路をなぞる順に並んでいる。迷ったら `retro_search_strategy` を呼ぶ。

## 基本の流れ

### 1. 当たりを付ける（どのホストに居たか）

`legacy_hosts` で当時のホスティング一覧を得る。主題から置き場所を推測する。

| 主題 | 見るべきホスト |
| --- | --- |
| 二次創作・CG・同人 | `geocities.co.jp`（エリア別）、`isweb.infoseek.co.jp` |
| テキスト・日記 | `readme.jp`、`tesio.net`（日記才人）、`isweb` |
| 技術・研究 | `ac.jp/~user/`、`asahi-net.or.jp/~user/`、`bekkoame.ne.jp` |
| 何でも | `dir.yahoo.co.jp`（人力ディレクトリ＝最大の名簿） |

### 2. 個人サイトを直接列挙する ← 最も効く

```
discover_sites(url="www.geocities.co.jp/Playtown-Bingo", from="1998", to="2002")
```

これが主力。ホスティング配下に **どんなサイトが実在したか** をユーザー単位で一覧化する。
実測で 1 エリアから 148 サイトが出る。`observedFiles` が多いものほど中身が濃い。

**ジオシティーズのエリア名は細分されている**点に注意。`Playtown` だけでなく
`Playtown-Bingo` `Playtown-Denen` のようなハイフン付きが本体。エリア名が分からなければ
`wayback_cdx_search(url="www.geocities.co.jp", matchType="host")` で当たりを付ける。

`wayback_cdx_search` はファイル単位で返るため、1 サイトの画像群で件数を食い潰す。
**サイトを探す目的では必ず `discover_sites` を使う。**

### 3. 中身を読む

```
wayback_snapshot(url=<siteRoot>, timestamp="2000")   # 最寄りのスナップショットを取る
wayback_fetch_page(url=<siteRoot>, timestamp=<ts>)   # 本文（文字コード自動判別）
```

Shift_JIS / EUC-JP は自動で復号される。それでも化ける場合は `raw=true` で
`meta charset` を確認する。

### 4. 芋づる（ここで検索不可能な領域へ入る）

```
wayback_outlinks(url=<siteRoot>, timestamp=<ts>, externalOnly=true)
```

当時のサイトはほぼ必ず「リンク」ページを持つ。そこを辿ると相互リンク先へ広がる。
**2〜3 段辿ると、どの検索エンジンにも存在しないサイトに届く。**

効果が高い起点:
- サイト内の `link.html` / `link.htm` / `links/`（`wayback_cdx_search` で探す）
- Web リングのハブ、はてなアンテナ、ReadMe! / 日記才人のランキング
- `dir.yahoo.co.jp` の 1997〜2001 年スナップショット

### 5. 現行検索エンジンも当時の語彙で叩く（並行）

```
build_retro_queries(keyword="<主題>")
```

生成された `siteQueries` と `phraseQueries` を **1 本ずつ** WebSearch へ渡す。
`site:` 絞り込みと当時の言い回し（リンクフリー / キリ番 / 相互リンク募集 / 工事中 /
800×600 / Netscape Navigator 推奨）が効く。Bing・DuckDuckGo は Google と別索引なので併用する。

## 補助ツール

- `warp_search_url` — 国立国会図書館 WARP の検索 URL を生成。**結果の自動取得は不可**
  （JS 描画＋API が 403）。ブラウザで開く。収集開始が 2002 年なので 90 年代には弱い。
- `marginalia_search_url` — Marginalia の検索 URL を生成。**英語専用**なので
  日本語サイト本体には使えない。英語圏の retro web 資料を探すとき用。

## 落とし穴

| 症状 | 原因と対処 |
| --- | --- |
| CDX が 0 件 | `matchType` を `domain` に広げる。年代指定を外す。ホスト名を `legacy_hosts` で確認 |
| 内容から探せない | CDX は全文検索ではない。**必ず先にドメインか URL 断片を得る**のが前提 |
| 文字化け | 自動判別済みだが失敗したら `raw=true` で `meta charset` を確認 |
| スナップショットが取れない | Availability API はレート制限時に HTTP 200 で空を返す（CDX へ自動フォールバック済み）。年代を変えて再試行 |
| 本文が空 | robots 除外やサーバ消滅。**別の年代のスナップショット**を試す |

## /drdr など調査タスクからの使い方

深掘り調査で古いサイトを扱うときは、Web 検索に頼らず本 MCP のツールを直接使う。
サブエージェントからは `ToolSearch` でツールが見えるので、最初に
`retro_search_strategy` を呼んで手順を取得してから作業に入るとブレない。
