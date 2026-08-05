#!/usr/bin/env node
/**
 * Retroweb MCP — 90 年代〜2000 年代前半の日本語個人サイトを Web アーカイブから発掘する MCP サーバ。
 *
 * 設計方針:
 *   現行検索エンジンのインデックスから消えた領域が対象なので「全文検索」は成立しない。
 *   代わりに (1) アーカイブ内の URL 空間を列挙し (2) 保存済みページのリンクを辿る、
 *   という当時の発見経路（ディレクトリとリンク集）を再現することで到達する。
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import {
  cdxSearch,
  checkAvailability,
  discoverSites,
  extractOutlinks,
  fetchArchivedPage,
  htmlToText,
} from "./wayback.js";
import { buildMarginaliaQuery } from "./marginalia.js";
import { buildWarpQuery } from "./warp.js";
import {
  LEGACY_HOSTS,
  PERIOD_PHRASES,
  buildSiteQueries,
} from "./legacy-domains.js";

const server = new McpServer({
  name: "retroweb",
  version: "1.0.0",
});

/** ツールの戻り値を MCP のテキストコンテンツに整形する */
function json(data: unknown) {
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(data, null, 2) },
    ],
  };
}

function fail(message: string) {
  return {
    content: [{ type: "text" as const, text: `エラー: ${message}` }],
    isError: true,
  };
}

/** 例外を利用者向けメッセージへ落とす共通ラッパ */
async function guard<T>(fn: () => Promise<T>) {
  try {
    return json(await fn());
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

// ---------------------------------------------------------------------------
// 1. Wayback CDX 検索 — 消えたサイトの「目次」を得る
// ---------------------------------------------------------------------------
server.registerTool(
  "wayback_cdx_search",
  {
    title: "Wayback アーカイブ URL 列挙",
    description:
      "Internet Archive の CDX API で、あるドメインやパス配下に保存されている URL を年代指定で列挙する。" +
      "90年代・昔のサイト・消えたページ・閉鎖したホームページ・ジオシティーズなど、" +
      "Google のインデックスから消えた古い個人サイトを探す際の起点となるツール。" +
      "全文検索ではなくドメイン単位の列挙である点に注意（内容から探すことはできない）。",
    inputSchema: {
      url: z
        .string()
        .describe(
          "対象 URL またはドメイン。例: 'geocities.co.jp/Playtown' や 'www.asahi-net.or.jp/~abc12345'",
        ),
      matchType: z
        .enum(["exact", "prefix", "host", "domain"])
        .optional()
        .describe(
          "prefix=そのパス配下（既定）, host=そのホストのみ, domain=サブドメイン含む, exact=完全一致",
        ),
      from: z.string().optional().describe("開始年。'1996' や '199601' の形式"),
      to: z.string().optional().describe("終了年。'2001' など"),
      limit: z.number().int().min(1).max(2000).optional().describe("最大件数（既定 100）"),
      onlyOk: z
        .boolean()
        .optional()
        .describe("HTTP 200 のスナップショットのみに絞る（既定 true）"),
      mimeType: z
        .string()
        .optional()
        .describe("MIME 絞り込み。例: 'text/html'"),
    },
  },
  async (args) =>
    guard(async () => {
      const records = await cdxSearch(args);
      return {
        count: records.length,
        hint:
          records.length === 0
            ? "0 件でした。matchType を 'domain' に広げるか、年代指定を外して再試行してください。ホスト名が違う可能性もあります（legacy_hosts で当時のホスト一覧を確認）。"
            : "各 snapshotUrl は wayback_fetch_page や wayback_outlinks の入力に使えます。",
        records,
      };
    }),
);

// ---------------------------------------------------------------------------
// 1-b. 個人サイトの列挙 — 「そこにどんなサイトがあったか」を知る
// ---------------------------------------------------------------------------
server.registerTool(
  "discover_sites",
  {
    title: "個人サイトの一覧を発掘",
    description:
      "あるホストやエリア配下に『どんな個人サイトが存在したか』を列挙する。" +
      "ジオシティーズのエリア（例 www.geocities.co.jp/Playtown-Bingo）やプロバイダのユーザー領域を指定すると、" +
      "ユーザーごとのサイト単位に畳んで一覧化する。" +
      "wayback_cdx_search はファイル単位で返るため 1 サイトの画像群に埋もれてしまうが、" +
      "こちらはページを跨いで収集しサイト単位にまとめるため、無名サイトの発見にはこちらを使う。" +
      "検索エンジンに一切載っていない 90年代の個人ホームページを見つける主力ツール。",
    inputSchema: {
      url: z
        .string()
        .describe(
          "ホストまたはエリアの prefix。例: 'www.geocities.co.jp/Playtown-Bingo' 'homepage1.nifty.com'",
        ),
      from: z.string().optional().describe("開始年。例 '1998'"),
      to: z.string().optional().describe("終了年。例 '2002'"),
      maxRecords: z
        .number()
        .int()
        .min(100)
        .max(10_000)
        .optional()
        .describe("CDX から読み取るレコード上限（既定 3000）。多いほど網羅的だが遅い"),
      htmlOnly: z
        .boolean()
        .optional()
        .describe("HTML のみ対象にする（既定 true）。false で画像等も数える"),
      limit: z.number().int().min(1).max(500).optional().describe("返すサイト数（既定 100）"),
    },
  },
  async ({ url, from, to, maxRecords, htmlOnly, limit = 100 }) =>
    guard(async () => {
      const sites = await discoverSites({ url, from, to, maxRecords, htmlOnly });
      return {
        totalSites: sites.length,
        hint:
          sites.length === 0
            ? "0 件でした。prefix が細かすぎるか、そのホストがアーカイブされていない可能性があります。legacy_hosts でホスト名を確認してください。"
            : "observedFiles が多いサイトほど中身が充実していた傾向があります。siteRoot を wayback_fetch_page / wayback_outlinks に渡して掘り下げてください。" +
              "latestFirstSeen は『少なくともこの時点まで存在した』下限値で、最新キャプチャではありません（知りたいときは siteRoot を wayback_snapshot へ）。",
        sites: sites.slice(0, limit),
      };
    }),
);

// ---------------------------------------------------------------------------
// 2. スナップショット存在確認
// ---------------------------------------------------------------------------
server.registerTool(
  "wayback_snapshot",
  {
    title: "Wayback スナップショット確認",
    description:
      "指定 URL が Internet Archive に保存されているか、指定時点に最も近いスナップショットを 1 件調べる。" +
      "昔のサイトの URL に心当たりがあるとき、それが今も辿れるかを最小コストで確認する用途。",
    inputSchema: {
      url: z.string().describe("確認したい当時の URL"),
      timestamp: z
        .string()
        .optional()
        .describe("希望時点。'1999' や '20000401' の形式。省略時は最新"),
    },
  },
  async ({ url, timestamp }) =>
    guard(() => checkAvailability(url, timestamp)),
);

// ---------------------------------------------------------------------------
// 3. アーカイブ本文取得
// ---------------------------------------------------------------------------
server.registerTool(
  "wayback_fetch_page",
  {
    title: "アーカイブ済みページ本文取得",
    description:
      "保存済みの古いページ本文を取得する。Wayback のツールバーを含まない生 HTML を取るため、" +
      "当時のページの内容確認やテキスト化に適する。文字化けする場合は raw=true で生 HTML を確認する。",
    inputSchema: {
      url: z.string().describe("当時の元 URL（web.archive.org 付きでも可）"),
      timestamp: z.string().describe("14 桁タイムスタンプ。cdx 検索の結果をそのまま渡す"),
      raw: z
        .boolean()
        .optional()
        .describe("true で生 HTML、false（既定）でプレーンテキスト化"),
      maxChars: z.number().int().min(500).max(50_000).optional().describe("最大文字数（既定 8000）"),
    },
  },
  async ({ url, timestamp, raw = false, maxChars = 8000 }) =>
    guard(async () => {
      // web.archive.org 形式で渡された場合に元 URL を取り戻す
      const original =
        url.match(/\/web\/\d+[a-z_]*\/(.+)$/i)?.[1] ?? url;
      const html = await fetchArchivedPage(original, timestamp);
      return {
        url: original,
        timestamp,
        contentLength: html.length,
        content: raw ? html.slice(0, maxChars) : htmlToText(html, maxChars),
      };
    }),
);

// ---------------------------------------------------------------------------
// 4. 芋づるリンク抽出 — 本サーバの中核
// ---------------------------------------------------------------------------
server.registerTool(
  "wayback_outlinks",
  {
    title: "アーカイブ内リンク辿り（芋づる発掘）",
    description:
      "保存済みページから外部リンクを抽出する。90年代の個人サイトは検索ではなく" +
      "相互リンクと Web リングで発見される設計だったため、当時のリンク集ページを起点に" +
      "これを繰り返すのが、検索エンジンに載っていないマイナーな古いサイトへ到達する最有力の手段。" +
      "リンク集・Web リング・アンテナ・ランキングサイトのページに対して使うと効果が高い。",
    inputSchema: {
      url: z.string().describe("起点となる当時の URL（リンク集ページが望ましい）"),
      timestamp: z.string().describe("14 桁タイムスタンプ"),
      externalOnly: z
        .boolean()
        .optional()
        .describe("外部サイトへのリンクのみ返す（既定 true）"),
      limit: z.number().int().min(1).max(500).optional().describe("最大件数（既定 200）"),
    },
  },
  async ({ url, timestamp, externalOnly = true, limit = 200 }) =>
    guard(async () => {
      const original = url.match(/\/web\/\d+[a-z_]*\/(.+)$/i)?.[1] ?? url;
      const links = await extractOutlinks(original, timestamp, {
        externalOnly,
        limit,
      });
      const hosts = [...new Set(links.map((l) => {
        try {
          return new URL(l.url).host;
        } catch {
          return "";
        }
      }).filter(Boolean))];

      return {
        source: { url: original, timestamp },
        count: links.length,
        distinctHosts: hosts.length,
        hint:
          "得られた URL は wayback_snapshot で生存確認 → wayback_outlinks でさらに辿る、を繰り返すと芋づる式に広がります。",
        hosts,
        links,
      };
    }),
);

// ---------------------------------------------------------------------------
// 5. 当時のホスト辞書 / 検索クエリ生成
// ---------------------------------------------------------------------------
server.registerTool(
  "legacy_hosts",
  {
    title: "90年代日本語サイトのホスト辞書",
    description:
      "90年代〜2000年代前半の日本語個人サイトが置かれていた無料ホームページサービス・" +
      "プロバイダスペース・ランキングサイトの一覧を返す。ジオシティーズ、@nifty、BIGLOBE、" +
      "ベッコアメ、Infoseek isweb など。CDX 探索の起点選びや site: 絞り込みに使う。",
    inputSchema: {
      category: z
        .enum(["free-hosting", "isp-space", "university", "community"])
        .optional()
        .describe("種別で絞る。community は発見の入口（ランキング・ディレクトリ・リング）"),
    },
  },
  async ({ category }) =>
    guard(async () => {
      const hosts = category
        ? LEGACY_HOSTS.filter((h) => h.category === category)
        : LEGACY_HOSTS;
      return { count: hosts.length, hosts };
    }),
);

server.registerTool(
  "build_retro_queries",
  {
    title: "レトロサイト向け検索クエリ生成",
    description:
      "現行の検索エンジン（Google / Bing 等）に投げるための、当時のホストを site: で絞り込んだ" +
      "クエリ群と、90年代特有の言い回し（リンクフリー、キリ番、相互リンク募集、工事中 など）を" +
      "組み合わせた検索語を生成する。素のキーワードより命中率が上がる。" +
      "生成されたクエリは WebSearch ツールへそのまま渡して使う。",
    inputSchema: {
      keyword: z.string().describe("探したい主題。例: '東方 CG 集' '個人 日記'"),
      categories: z
        .array(z.enum(["free-hosting", "isp-space", "university", "community"]))
        .optional()
        .describe("site: に含めるホスト種別。省略時は全部"),
      includePeriodPhrases: z
        .boolean()
        .optional()
        .describe("当時の言い回しを組み合わせたクエリも生成する（既定 true）"),
    },
  },
  async ({ keyword, categories, includePeriodPhrases = true }) =>
    guard(async () => {
      const siteQueries = buildSiteQueries(keyword, categories);
      const phraseQueries = includePeriodPhrases
        ? PERIOD_PHRASES.slice(0, 8).map((p) => `"${p.phrase}" ${keyword}`)
        : [];
      return {
        siteQueries,
        phraseQueries,
        periodPhrases: PERIOD_PHRASES,
        hint:
          "siteQueries は 1 本ずつ WebSearch に投げること（OR を繋げすぎると検索側に無視されます）。" +
          "ヒットしたらその URL を wayback_cdx_search と wayback_outlinks に渡して掘り下げます。",
      };
    }),
);

// ---------------------------------------------------------------------------
// 6. Marginalia（英語圏の retro web 資料向け）
// ---------------------------------------------------------------------------
server.registerTool(
  "marginalia_search_url",
  {
    title: "Marginalia 検索 URL 生成（独立系・非商業サイト優遇）",
    description:
      "商業性の低い個人サイトや古いページを優遇する独立系検索エンジン Marginalia の検索 URL を組み立てる。" +
      "【制約】Marginalia は公式に英語専用で、日本語クエリでは結果が返らない。" +
      "またサービス移行中で HTML 構造が不安定なため、結果の自動取得は行わずブラウザでの閲覧を前提とする。" +
      "日本語の古いサイト本体を探す用途には使えない（wayback_* ツールを使うこと）。",
    inputSchema: {
      query: z.string().describe("検索語（英語のみ有効）"),
    },
  },
  async ({ query }) => guard(async () => buildMarginaliaQuery(query)),
);

// ---------------------------------------------------------------------------
// 7. NDL WARP（URL 生成のみ）
// ---------------------------------------------------------------------------
server.registerTool(
  "warp_search_url",
  {
    title: "国立国会図書館 WARP 検索 URL 生成",
    description:
      "日本語サイト特化の国立国会図書館ウェブアーカイブ（WARP）の検索 URL を組み立てる。" +
      "【制約】WARP は検索結果を JavaScript で描画し内部 API も 403 でブロックされているため、" +
      "HTTP 取得では結果を読めない。本ツールは URL とブラウザでの閲覧手順を返すのみ。" +
      "また WARP の収集開始は 2002 年で 90 年代のページはほぼ対象外。",
    inputSchema: {
      keyword: z.string().describe("検索語、または調べたいサイトの URL"),
      includeInLibrary: z
        .boolean()
        .optional()
        .describe("館内限定公開の資料も対象に含める"),
    },
  },
  async ({ keyword, includeInLibrary = false }) =>
    guard(async () =>
      buildWarpQuery(keyword, {
        internet: true,
        inLibrary: includeInLibrary,
      }),
    ),
);

// ---------------------------------------------------------------------------
// 8. 探索戦略ガイド — /drdr など、ツールだけ見て手順が分からない呼び出し元向け
// ---------------------------------------------------------------------------
server.registerTool(
  "retro_search_strategy",
  {
    title: "レトロサイト発掘の探索手順",
    description:
      "90年代の日本語個人サイトなど、検索エンジンに載っていない古いマイナーサイトを探すための" +
      "手順書を返す。どのツールをどの順で使うか迷ったとき、最初にこれを呼ぶ。",
    inputSchema: {
      topic: z.string().optional().describe("探したい主題（あれば手順を具体化する）"),
    },
  },
  async ({ topic }) =>
    guard(async () => ({
      principle:
        "90年代の個人サイトは『検索』ではなく『ディレクトリとリンク集とWebリング』で発見される設計だった。" +
        "したがって現代の全文検索を強化するのではなく、当時の発見経路をアーカイブ上で再生するのが唯一確実な方法。",
      steps: [
        {
          step: 1,
          action: "起点となるホストを決める",
          tool: "legacy_hosts",
          detail:
            "主題に合う無料ホスティング／プロバイダを選ぶ。入口が欲しいなら category='community'（Yahoo!ディレクトリ、ReadMe!、日記才人、WebRing）。",
        },
        {
          step: 2,
          action: "当時のディレクトリ／ランキングのスナップショットを列挙する",
          tool: "wayback_cdx_search",
          detail:
            "例: url='dir.yahoo.co.jp', from='1997', to='2001'。ここが 90年代日本語サイトの最大の名簿。",
        },
        {
          step: "2-b",
          action: "ホスティング配下に存在した個人サイトを直接列挙する",
          tool: "discover_sites",
          detail:
            "例: url='www.geocities.co.jp/Playtown-Bingo', from='1998', to='2002'。" +
            "ジオシティーズは <エリア名>/<番地>/ が 1 ユーザー。エリア名は Playtown-Bingo のようにハイフン付きの細分がある。" +
            "ディレクトリ経由より直接的で、検索エンジンに一切載っていないサイトがそのまま出てくる。",
        },
        {
          step: 3,
          action: "そのページから参加サイトのリンクを抜く",
          tool: "wayback_outlinks",
          detail:
            "ディレクトリ／リング／アンテナのページに対して実行すると、個人サイトの URL がまとめて取れる。ここが本命。",
        },
        {
          step: 4,
          action: "得た URL の生存を確認し、内容を読む",
          tool: "wayback_snapshot → wayback_fetch_page",
          detail: "主題に合致するか判定する。",
        },
        {
          step: 5,
          action: "合致したサイトの『リンク』ページで芋づるを繰り返す",
          tool: "wayback_outlinks",
          detail:
            "当時のサイトはほぼ必ずリンクページを持つ。ここを再帰的に辿るのが最も深く潜れる。2〜3 段辿ると検索では絶対に出ないサイトに届く。",
        },
        {
          step: 6,
          action: "並行して現行検索エンジンも当時の語彙で叩く",
          tool: "build_retro_queries → WebSearch",
          detail:
            "site: 絞り込みと当時の言い回し（リンクフリー、キリ番、工事中）を使う。Bing / DuckDuckGo は Google と別索引なので併用する。",
        },
      ],
      pitfalls: [
        "Wayback の CDX は全文検索ではない。ページ内容からは探せないので、必ずドメインか URL 断片を先に手に入れる。",
        "WARP は 2002 年以降の収集で、90年代はほぼ入っていない。90年代狙いなら Wayback 一択。",
        "Marginalia は日本語索引が弱く、日本語クエリはほぼ 0 件。",
        "アーカイブに残っていても robots 除外やサーバ消滅で本文が取れないことがある。複数の年代のスナップショットを試す。",
        "文字コードは Shift_JIS / EUC-JP が主流。文字化けしたら raw=true で生 HTML を見て meta charset を確認する。",
      ],
      topicSpecific: topic
        ? `主題「${topic}」については、まず build_retro_queries で site: クエリを生成して当たりを付け、` +
          `ヒットした 1 サイトの URL を wayback_outlinks に入れて周辺サイトへ広げるのが速い。`
        : undefined,
    })),
);

const transport = new StdioServerTransport();
await server.connect(transport);
