# @kagayoi/retroweb-mcp

[![npm version](https://img.shields.io/npm/v/@kagayoi/retroweb-mcp)](https://www.npmjs.com/package/@kagayoi/retroweb-mcp)

90 年代〜2000 年代前半の**個人サイト**を Web アーカイブから発掘するための MCP サーバ。
**日本語圏と海外（英語圏・欧州・豪州）の双方**に対応する。

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

海外も同じ経路が使える。`discover_sites(url="www.geocities.com/SoHo", from="1997", to="2001")` で
**163 サイト**（`SoHo/Exhibit/5905/` `SoHo/Square/1549/` など）が出る。

## ツール

| ツール | 用途 |
| --- | --- |
| `discover_sites` | **主力**。ホスト配下に存在した個人サイトをユーザー単位で列挙する |
| `wayback_cdx_search` | アーカイブ済み URL をファイル単位で列挙する |
| `wayback_snapshot` | 指定時点に最も近いスナップショットを解決する |
| `wayback_fetch_page` | 保存済みページ本文を取得（Shift_JIS / EUC-JP / Latin-1 自動判別） |
| `wayback_outlinks` | ページから外部リンクを抽出（芋づる発掘の中核） |
| `legacy_hosts` | 当時のホスティング・ISP・ディレクトリの辞書（94 件 / `region` で日本・海外を切替） |
| `build_retro_queries` | `site:` 絞り込みと当時の言い回しによる検索クエリ生成（日英） |
| `wiby_search` | **海外専用**。旧式ページだけを索引する検索エンジンの全文検索（後述） |
| `retro_search_strategy` | 探索手順そのものを返す。迷ったら最初に呼ぶ（`region` で分岐） |
| `warp_search_url` | 国立国会図書館 WARP の検索 URL 生成（取得は不可、後述） |
| `marginalia_search_url` | Marginalia の検索 URL 生成（英語専用、後述） |

## 海外サイトの探索

日本語圏との違いは 3 点で、いずれもツール側が吸収している。

### 1. ホストと URL の階層が違う

| | 日本語圏 | 海外 |
| --- | --- | --- |
| 無料ホスティング | ジオシティーズ、isweb、FC2WEB | GeoCities 本家、Angelfire、Tripod、Xoom、FortuneCity、AOL |
| ISP スペース | @nifty、BIGLOBE、ベッコアメ | 英 Demon / Virgin、独 T-Online、仏 Wanadoo / Multimania、蘭 XS4ALL |
| 発見の入口 | Yahoo!ディレクトリ、ReadMe!、日記才人 | DMOZ、dir.yahoo.com、WebRing、RingSurf |

ユーザー領域の畳み方も違う。日本版ジオシティーズが `/<エリア>/<番地>/` の 2 階層なのに対し、
**本家は `/<Neighborhood>/<Suburb>/<番地>/` の 3 階層**があり（実測: `/Area51/Vault/1005/`）、
Angelfire は `/<地区コード>/<ユーザー>/` と中間ディレクトリを挟む。

`discover_sites` はこれを規則とデータの両面で処理する。番地形は規則で畳み、
規則で決まらないホストは**同じ階層に何種類の子ディレクトリがぶら下がったかを数え**、
閾値を超えたものを「地区」とみなして 1 段深く畳み直す
（実測: `www.angelfire.com` → `/amiga/partyclub-vs/` のように個人単位へ割れる）。
ホスト名の辞書を持たなくても未知のホストで機能する。

### 2. 当時の言い回しが訳語では当たらない

`build_retro_queries(region="intl")` は英語圏の定型文へ切り替える。

| 日本語圏 | 海外 |
| --- | --- |
| 工事中 | "Under Construction" |
| キリ番 / アクセスカウンター | "You are visitor number" |
| 足跡帳 | "Sign my guestbook" |
| Netscape Navigator 推奨 | "Best viewed with Netscape" / "Netscape Now" |
| 相互リンク募集 | "Cool Links" / "webring" |

除外する商業ドメインも地域で入れ替わる（Yahoo!ショッピング・楽天 ↔ eBay・Etsy・Pinterest）。

### 3. 海外にだけ全文検索の抜け道がある

`wiby_search` は、昔ながらの手打ちページだけを人手で索引している検索エンジン Wiby を叩く。
**本サーバで唯一、内容から探せる経路**（実測: `amiga demoscene` で 12 件）。

ただし索引対象は「**今も生きている**旧式ページ」であってアーカイブではないため、
消えたサイトを探すには `wayback_*` と併用する。日本語の索引はほぼ無く、英語専用。
1 リクエスト 12 件固定で、`o=` 等のオフセット指定は空ボディを返すためページングできない。

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
| Wiby | `/json/?q=` が JSON を返す。12 件固定で `o=` は空ボディ（ページング不可）、0 件は空配列 | ツール化（海外向けの全文検索） |

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
   **現在も事業サイトが動いているドメインは既定のクエリから外す**（94 件中 26 件）。
   `build_retro_queries` の `includeModernHosts: true` で戻せる。
2. 全クエリの末尾に `-site:shopping.geocities.jp` など商業ドメインの除外句を付ける。

なおこの経路自体の期待値は低い。当時のホストはほぼ索引から消えているため、
実際に届くのは `discover_sites` → `wayback_outlinks` の芋づるのほう。

### 文字コード

当時の日本語ページは Shift_JIS / EUC-JP が主流で、`meta charset` を持たないものも多い
（1997 年の Yahoo! JAPAN トップは meta 無し）。`res.text()` は UTF-8 決め打ちのため
そのままでは全文が化ける。本サーバはヘッダ → meta → **バイト分布からの推定**の順で判定する。

海外ページを対象にすると、この推定が逆向きに誤爆する。

- 西欧語ページはアクセント記号が数個散っているだけで、単独の高位バイト（`ü`=0xFC）が
  Shift_JIS の 2 バイト目を拾って化ける。→ **高位バイトの密度**を見て、疎なら windows-1252 に倒す
  （日本語ページは本文が丸ごと多バイトなので 1〜3 割を占める）。
  「ほぼ ASCII なら UTF-8」という近道も外した。実測の 2001 年 `home.t-online.de` は
  1139 バイト中 3 バイトだけが高位バイトで、UTF-8 として読むと U+FFFD になる。
- UTF-8 の `é`（0xC3 0xA9）は EUC-JP の 2 バイト範囲に収まるため、EUC-JP と誤判定される。
  → 高位バイトのほぼ全てが妥当な UTF-8 列なら、多数決の前に UTF-8 で確定させる。
- 欧州のページは `&eacute;` `&uuml;` のような**名前付き実体参照**を多用する。未対応だと
  "la page demand&eacute;e" のまま本文に出る。→ 基底文字＋結合記号の NFC 合成で表を生成し、
  記号・約物と併せて復号する。

## セットアップ

npm の最新版を使う場合:

```bash
claude mcp add retroweb -- npx --yes @kagayoi/retroweb-mcp@latest
```

MCP クライアントへ直接設定する場合:

```json
{
  "mcpServers": {
    "retroweb": {
      "command": "npx",
      "args": ["--yes", "@kagayoi/retroweb-mcp@latest"]
    }
  }
}
```

ローカル clone から開発する場合:

```bash
pnpm install && pnpm build
```

ローカル build を Claude Code へ登録:

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
