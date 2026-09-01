---
name: retroweb
description: 90年代〜2000年代前半の個人サイト（日本語圏・海外の双方）など、Google に載っていない古いマイナーなページを Web アーカイブから発掘する手順。Use when the user asks to find old personal websites from the 90s, 90年代のサイト, 昔のホームページ, 消えたサイト, ジオシティーズ, 閉鎖したサイト, old GeoCities/Angelfire/Tripod/AOL pages, retro web, dead websites, or wants to search for pages that current search engines no longer index — in Japanese or any other language.
---

# レトロサイト発掘の手順

## 前提となる考え方

90 年代の個人サイトは **「検索」ではなく「ディレクトリとリンク集と Web リング」で発見される設計**だった。
現代の検索エンジンを工夫しても届かないのは、索引が存在しないからで、クエリの問題ではない。

したがって取るべき戦略は 1 つ: **当時の発見経路をアーカイブ上で再生する**。

これは日本語圏でも海外でも変わらない。違うのは**ホスト名・URL の階層・当時の言い回し**の 3 点で、
海外にだけ全文検索の抜け道（`wiby_search`）がある。

Retroweb MCP のツールはこの経路をなぞる順に並んでいる。迷ったら `retro_search_strategy` を呼ぶ
（海外なら `region="intl"` を付ける）。

## 基本の流れ

### 1. 当たりを付ける（どのホストに居たか）

`legacy_hosts` で当時のホスティング一覧を得る。主題から置き場所を推測する。
**`region` を指定しないと日本語圏と海外が混ざって返る**（`jp` / `intl` / `us` `uk` `fr` `de` `it` `nl` `au` / `global`）。

日本語圏:

| 主題 | 見るべきホスト |
| --- | --- |
| 二次創作・CG・同人 | `geocities.co.jp`（エリア別）、`isweb.infoseek.co.jp` |
| テキスト・日記 | `readme.jp`、`tesio.net`（日記才人）、`isweb` |
| 技術・研究 | `ac.jp/~user/`、`asahi-net.or.jp/~user/`、`bekkoame.ne.jp` |
| 何でも | `dir.yahoo.co.jp`（人力ディレクトリ＝最大の名簿） |

海外:

| 主題 | 見るべきホスト |
| --- | --- |
| SF・ゲーム・オカルト | `www.geocities.com/Area51`（本家のエリア名は主題に対応している） |
| アート・音楽・映画 | `www.geocities.com/SoHo` `/Hollywood` `/Vienna`、`www.angelfire.com` |
| 技術・学術 | `www.geocities.com/SiliconValley` `/Athens`、`edu/~user/`、`ac.uk/~user/` |
| 個人の日常・家族 | `members.aol.com`、`hometown.aol.com`、`www.geocities.com/Heartland` |
| 欧州語圏 | 英 `homepages.demon.co.uk`、独 `home.t-online.de`、仏 `perso.wanadoo.fr` / `www.multimania.com`、伊 `digilander.iol.it` |
| 何でも | `dmoz.org`（人力ディレクトリ＝海外最大の名簿）、`dir.yahoo.com` |

### 2. 個人サイトを直接列挙する ← 最も効く

```
discover_sites(url="www.geocities.co.jp/Playtown-Bingo", from="1998", to="2002")
```

これが主力。ホスティング配下に **どんなサイトが実在したか** をユーザー単位で一覧化する。
実測で 1 エリアから 148 サイトが出る。`observedFiles` が多いものほど中身が濃い。

**エリア名が分からなければホスト名だけで呼んでよい。**

```
discover_sites(url="www.geocities.co.jp", from="1997", to="2002")
```

索引全体へ散らして読むので、実在したエリア名が `siteRoot` に出てくる
（実測: 12 エリアにまたがる 226 サイトが 6 秒）。ただし結果は**網羅ではなく標本**で、
`coverage.sampled` が `true` になる。目当てのエリアが見えたら、そのエリアで呼び直すと深く掘れる。

**ジオシティーズのエリア名は細分されている**点に注意。`Playtown` だけでなく
`Playtown-Bingo` `Playtown-Denen` のようなハイフン付きが本体。

**海外は URL の階層が違う。**

```
discover_sites(url="www.geocities.com/SoHo", from="1997", to="2001")   # 実測 163 サイト
discover_sites(url="www.angelfire.com", from="1999", to="2002")
```

- 本家 GeoCities は `/<Neighborhood>/<番地>/` に加えて **`/<Neighborhood>/<Suburb>/<番地>/` の 3 階層**がある
  （`/Area51/Vault/1005/`）。日本版のハイフン細分（`Playtown-Bingo`）に相当するのがこの Suburb。
- Angelfire は `/<地区コード>/<ユーザー>/` と中間ディレクトリを挟む（`/on/username/`）。
  `discover_sites` が子ディレクトリの多さから地区を判定して 1 段深く畳むので、ホスト名だけ渡してよい。
  ただし**標本が小さいとこの判定が働かない**ので、結果が `/on/` のような地区で止まっていたら
  `maxRecords` を上げるか、その地区を prefix にして呼び直す。

`wayback_cdx_search` はファイル単位で返るため、1 サイトの画像群で件数を食い潰す。
prefix / host / domain の広い指定は CDX ブロックを分散走査し、結果が標本なら
`coverage.sampled=true` になる。URL・年代を絞るか `limit` を上げて深掘りする。
**サイトを探す目的では必ず `discover_sites` を使う。**

### 3. 中身を読む

```
wayback_snapshot(url=<siteRoot>, timestamp="2000")   # 最寄りのスナップショットを取る
wayback_fetch_page(url=<siteRoot>, timestamp=<ts>)   # 本文（文字コード自動判別）
```

Shift_JIS / EUC-JP は自動で復号される。宣言された windows-1252 / Latin-1 系文字コード、
海外の Latin-1（独語のウムラウト、仏語のアクセント）と
`&eacute;` 形式の実体参照も復号される。それでも化ける場合は `raw=true` で `meta charset` を確認する。

### 4. 芋づる（ここで検索不可能な領域へ入る）

```
crawl_link_neighborhood(
  seeds=[<リンク集やディレクトリのURL>],
  timestamp="2000",
  maxDepth=2,
  pageBudget=8,
  keywords=[<主題語>]
)
```

当時のサイトはほぼ必ず「リンク」ページを持つ。そこを辿ると相互リンク先へ広がる。
**2〜3 段辿ると、現行の通常検索では見つけにくいサイトへ届きやすい。**
`sites` の `route` と `discoveredFrom` で発見経路を確認し、`snapshot` がある候補から本文を読む。
`coverage.truncated=true` なら `reasons` を確認し、必要な予算だけ増やすか、高得点候補を次の
`seeds` にして探索を分割する。`keywords` は URL とアンカーテキストの順位付けであり、本文検索ではない。

1 ページのリンクだけを確認したい場合は、低レベル操作の
`wayback_outlinks(url=<siteRoot>, timestamp=<ts>, externalOnly=true)` を使う。

効果が高い起点（日本語圏）:
- サイト内の `link.html` / `link.htm` / `links/`（`wayback_cdx_search` で探す）
- Web リングのハブ、はてなアンテナ、ReadMe! / 日記才人のランキング
- `dir.yahoo.co.jp` の 1997〜2001 年スナップショット

効果が高い起点（海外）:
- サイト内の `links.html` / `cool.html` / `friends.html`
- `dmoz.org/<カテゴリ>` の 1999〜2003 年スナップショット（海外最大の人力名簿）
- `dir.yahoo.com` の 1996〜2000 年スナップショット
- `www.webring.org` / `www.ringsurf.com` / `www.bomis.com` のリング一覧

### 4-b. 海外なら全文検索も使える（ここだけ日本語圏と違う）

```
wiby_search(query="amiga demoscene")
```

Wiby は昔ながらの手打ちページだけを人手で索引している検索エンジンで、
**本 MCP で唯一、内容から探せる経路**。海外の主題ならまずこれを叩いて起点を掴み、
出てきた URL を `crawl_link_neighborhood` の `seeds` に渡して当時のリンク集へ遡る。

制約: 索引対象は**今も生きている**旧式ページ（アーカイブではない）／英語専用／
1 回 12 件でページング不可（続きが要るなら語を変えて呼び直す）。

### 5. 現行検索エンジンも当時の語彙で叩く（並行、期待値は低い）

```
build_retro_queries(keyword="<主題>")                    # 日本語圏
build_retro_queries(keyword="<topic>", region="intl")   # 海外（言い回しが英語になる）
```

生成された `siteQueries` と `phraseQueries` を **1 本ずつ** WebSearch へ渡す。
`site:` 絞り込みと当時の言い回し（リンクフリー / キリ番 / 相互リンク募集 / 工事中 /
800×600 / Netscape Navigator 推奨）を組み合わせる。Bing・DuckDuckGo は Google と別索引なので併用する。

**この経路は補助と割り切る。** 当時のホストは現行検索の索引からほぼ消えており、
検索側はヒットが乏しいと絞り込みを緩めて生きているドメインを返す
（実測: `site:geocities.co.jp 都市伝説` → Yahoo!ショッピングのみ）。
`build_retro_queries` は終了済みホストだけを使い、商業ドメインを `-site:` で除外した
クエリを返すので、**生成されたクエリをそのまま渡すこと**（自分で site: を書き足さない）。

当時の言い回しは**訳語では当たらない**。`region` を渡すと自動で切り替わる。

| 日本語圏 | 海外 |
| --- | --- |
| 工事中 | "Under Construction" |
| キリ番 / アクセスカウンター | "You are visitor number" |
| 足跡帳 | "Sign my guestbook" |
| Netscape Navigator 推奨 | "Best viewed with Netscape" |
| 相互リンク募集 | "Cool Links" / "webring" |

## 補助ツール

- `warp_search_url` — 国立国会図書館 WARP の検索 URL を生成。**結果の自動取得は不可**
  （JS 描画＋API が 403）。ブラウザで開く。収集開始が 2002 年なので 90 年代には弱い。日本語専用。
- `marginalia_search_url` — Marginalia の検索 URL を生成。**英語専用**なので
  日本語サイト本体には使えない。結果まで自動で欲しいときは `wiby_search` を使う。

## 落とし穴

| 症状 | 原因と対処 |
| --- | --- |
| CDX が 0 件 | `matchType` を `domain` に広げる。年代指定を外す。ホスト名を `legacy_hosts` で確認 |
| 海外のサイト根が `/on/` のような地区で止まる | 標本が小さく地区判定が働いていない。`maxRecords` を上げるか、その地区を prefix にして呼び直す |
| 本家 GeoCities で prefix が空振り | Suburb の有無で階層が変わる。`/Area51` まで下げて `discover_sites` に任せる |
| 内容から探せない | CDX は全文検索ではない。**必ず先にドメインか URL 断片を得る**のが前提 |
| `discover_sites` の結果が少ない・エリアが偏る | ホスト名だけの指定は標本抽出（`coverage.sampled`）。`maxRecords` を上げるか、出てきたエリア名で呼び直す |
| 検索結果がショッピングサイトばかり | `build_retro_queries` が返したクエリを**そのまま**渡す。自分で `site:` を組むと除外句が付かない |
| 文字化け | 自動判別済みだが失敗したら `raw=true` で `meta charset` を確認 |
| スナップショットが取れない | Availability API はレート制限時に HTTP 200 で空を返す（CDX へ自動フォールバック済み）。年代を変えて再試行 |
| 本文が空 | robots 除外やサーバ消滅。**別の年代のスナップショット**を試す |

## /drdr など調査タスクからの使い方

深掘り調査で古いサイトを扱うときは、Web 検索に頼らず本 MCP のツールを直接使う。
サブエージェントからは `ToolSearch` でツールが見えるので、最初に
`retro_search_strategy` を呼んで手順を取得してから作業に入るとブレない。
