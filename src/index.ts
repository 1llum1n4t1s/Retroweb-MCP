#!/usr/bin/env node
/**
 * Retroweb MCP — 90 年代〜2000 年代前半の個人サイトを Web アーカイブから発掘する MCP サーバ。
 * 日本語圏と海外（英語圏・欧州・豪州）の双方を対象にする。
 *
 * 設計方針:
 *   現行検索エンジンのインデックスから消えた領域が対象なので「全文検索」は成立しない。
 *   代わりに (1) アーカイブ内の URL 空間を列挙し (2) 保存済みページのリンクを辿る、
 *   という当時の発見経路（ディレクトリとリンク集）を再現することで到達する。
 *   唯一の例外が Wiby で、今も生きている旧式ページに限れば全文検索が使える（英語のみ）。
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import {
  checkAvailability,
  crawlLinkNeighborhood,
  discoverSites,
  extractOutlinks,
  fetchArchivedPage,
  htmlToText,
  searchCdxCatalog,
  unwrapWaybackUrl,
} from "./wayback.js";
import { buildMarginaliaQuery } from "./marginalia.js";
import { buildWarpQuery } from "./warp.js";
import { wibySearch } from "./wiby.js";
import {
  LEGACY_HOSTS,
  buildPhraseQueries,
  buildSiteQueries,
  matchesRegion,
  noiseDomainsFor,
  periodPhrases,
  phraseLangFor,
} from "./legacy-domains.js";

const server = new McpServer({
  name: "retroweb",
  version: "1.0.1",
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

/**
 * 地域指定。日本語圏と海外でホストも言い回しも別物なので、全ツールで同じ語彙を使う。
 * 'intl' は日本以外すべて、'global' は国を跨いだサービス（WebRing・DMOZ 等）だけを指す。
 */
const REGION_ENUM = [
  "jp",
  "intl",
  "us",
  "uk",
  "fr",
  "de",
  "it",
  "nl",
  "au",
  "global",
  "all",
] as const;

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
      "Google のインデックスから消えた古い個人サイトを探す際の起点となるツール。日本語圏・海外の双方に使える。" +
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
      const { records, strategy, totalPages, scannedPages, sampled, note } =
        await searchCdxCatalog(args);
      const hints: string[] = [];
      if (records.length === 0) {
        hints.push(
          "0 件でした。matchType を 'domain' に広げるか、年代指定を外して再試行してください。ホスト名が違う可能性もあります（legacy_hosts で当時のホスト一覧を確認）。",
        );
      } else {
        hints.push(
          "各 snapshotUrl は wayback_fetch_page、wayback_outlinks、crawl_link_neighborhood の入力に使えます。",
        );
      }
      if (sampled) {
        hints.push(strategy === "resumeKey"
          ? `ページ分割 API が使えず、resumeKey 方式で ${scannedPages} 回分だけを読んだ標本です（網羅ではありません）。` +
              "URL や年代を絞って再試行してください。"
          : `索引 ${totalPages} ブロック中 ${scannedPages} ブロックを読んだ標本です（網羅ではありません）。` +
              "URL や年代を絞るか、limit を上げると深く探索できます。",
        );
      }
      if (note) hints.push(note);

      return {
        count: records.length,
        coverage: { strategy, totalPages, scannedPages, sampled },
        hint: hints.join(" "),
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
    title: "個人サイトの一覧を発掘（日本語圏・海外）",
    description:
      "あるホストやエリア配下に『どんな個人サイトが存在したか』を列挙する。" +
      "ジオシティーズのエリア（日本 www.geocities.co.jp/Playtown-Bingo、本家 www.geocities.com/Area51）や" +
      "プロバイダのユーザー領域を指定すると、ユーザーごとのサイト単位に畳んで一覧化する。" +
      "日本版の /<エリア>/<番地>/、本家の /<Neighborhood>/<Suburb>/<番地>/、チルダ形式 /~user/、" +
      "Angelfire のような /<地区コード>/<ユーザー>/ をいずれも正しく畳む。" +
      "wayback_cdx_search はファイル単位で返るため 1 サイトの画像群に埋もれてしまうが、" +
      "こちらはページを跨いで収集しサイト単位にまとめるため、無名サイトの発見にはこちらを使う。" +
      "検索エンジンに一切載っていない 90年代の個人ホームページを見つける主力ツール。",
    inputSchema: {
      url: z
        .string()
        .describe(
          "ホストまたはエリアの prefix。例: 'www.geocities.co.jp/Playtown-Bingo' 'homepage1.nifty.com' " +
            "'www.geocities.com/Area51' 'www.angelfire.com' 'members.aol.com'。" +
            "ホスト名だけでも可（索引全体から散らして標本抽出する）",
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
      const { sites, totalPages, scannedPages, sampled, note } =
        await discoverSites({ url, from, to, maxRecords, htmlOnly });

      const hints: string[] = [];
      if (sites.length === 0) {
        hints.push(
          "0 件でした。prefix が細かすぎるか、そのホストがアーカイブされていない可能性があります。legacy_hosts でホスト名を確認してください。",
        );
      } else {
        hints.push(
          "observedFiles が多いサイトほど中身が充実していた傾向があります。siteRoot を wayback_fetch_page で読むか、crawl_link_neighborhood の起点にしてください。",
          "latestFirstSeen は『少なくともこの時点まで存在した』下限値で、最新キャプチャではありません（知りたいときは siteRoot を wayback_snapshot へ）。",
        );
      }
      if (sampled) {
        hints.push(
          `索引 ${totalPages} ブロック中 ${scannedPages} ブロックだけを読んだ標本です（網羅ではありません）。` +
            "同じ指定で呼び直しても同じ標本が返ります。網羅したいときは maxRecords を上げるか、" +
            "siteRoot に出てきたエリア名（例 '<host>/Playtown-Bingo'）まで絞って呼び直してください。",
        );
      }
      if (note) hints.push(note);

      return {
        totalSites: sites.length,
        // 標本抽出かどうかは結果の解釈を変えるので、必ず一緒に返す
        coverage: { totalPages, scannedPages, sampled },
        hint: hints.join(" "),
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
      const original = unwrapWaybackUrl(url);
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
      "リンク集・Web リング・アンテナ・ランキングサイトの 1 ページを確認する低レベル操作。" +
      "複数段を自動で辿る場合は、予算と失敗処理を持つ crawl_link_neighborhood を使う。",
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
      const original = unwrapWaybackUrl(url);
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
          "この結果は 1 ページ分です。複数段を自動で辿る場合は crawl_link_neighborhood の seeds に起点 URL を渡してください。",
        hosts,
        links,
      };
    }),
);

// ---------------------------------------------------------------------------
// 5. 上限付きリンク近傍クロール — 2〜3 段の芋づるを 1 回で行う
// ---------------------------------------------------------------------------
server.registerTool(
  "crawl_link_neighborhood",
  {
    title: "アーカイブ内リンク近傍クロール",
    description:
      "リンク集・ディレクトリ・Web リングなどの起点から、Wayback のスナップショットを解決しながら" +
      "外部リンクを幅優先で最大 3 段まで辿る。検索エンジンの索引から消えた候補サイトを、" +
      "発見元・アンカーテキスト・起点からの経路・確認できたスナップショット付きで返す。" +
      "Internet Archive へのアクセスは逐次実行し、ページ数・1ページのリンク数・候補数を必ず制限する。" +
      "個別ページが取得できなくても失敗を記録して残りを続行する。",
    inputSchema: {
      seeds: z
        .array(z.string().min(1))
        .min(1)
        .max(5)
        .describe("起点 URL（1〜5件）。当時のリンク集・カテゴリ・Web リングのページが望ましい"),
      timestamp: z
        .string()
        .optional()
        .describe("各 URL で最寄りのスナップショットを探す時点。例: '1999'。省略時は最新"),
      maxDepth: z
        .number()
        .int()
        .min(1)
        .max(3)
        .optional()
        .describe("辿るリンクの段数（既定 2、最大 3）"),
      pageBudget: z
        .number()
        .int()
        .min(1)
        .max(30)
        .optional()
        .describe("スナップショットを解決して展開するページ数（既定 8、最大 30）"),
      linksPerPage: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("各ページから採用するリンク数（既定 40、最大 100）"),
      candidateBudget: z
        .number()
        .int()
        .min(1)
        .max(500)
        .optional()
        .describe("重複排除後に保持する URL 数（起点を含む。既定 200、最大 500）"),
      externalOnly: z
        .boolean()
        .optional()
        .describe("取得元と別ホストのリンクだけを辿る（既定 true）"),
      keywords: z
        .array(z.string().min(1).max(120))
        .max(10)
        .optional()
        .describe(
          "候補を順位付けする主題語（最大10件）。URLとアンカーテキストだけを照合し、本文フィルタはしない",
        ),
    },
  },
  async (params) => guard(() => crawlLinkNeighborhood(params)),
);

// ---------------------------------------------------------------------------
// 6. 当時のホスト辞書 / 検索クエリ生成
// ---------------------------------------------------------------------------
server.registerTool(
  "legacy_hosts",
  {
    title: "90年代サイトのホスト辞書（日本語圏・海外）",
    description:
      "90年代〜2000年代前半の個人サイトが置かれていた無料ホームページサービス・" +
      "プロバイダスペース・ディレクトリの一覧を返す。" +
      "日本語圏はジオシティーズ、@nifty、BIGLOBE、ベッコアメ、Infoseek isweb など。" +
      "海外は GeoCities 本家、Angelfire、Tripod、Xoom、AOL、FortuneCity、" +
      "英 Demon、独 T-Online、仏 Multimania／Wanadoo、DMOZ など。" +
      "CDX 探索の起点選びや site: 絞り込みに使う。海外を探すなら region='intl' を指定する。",
    inputSchema: {
      category: z
        .enum(["free-hosting", "isp-space", "university", "community"])
        .optional()
        .describe("種別で絞る。community は発見の入口（ランキング・ディレクトリ・リング）"),
      region: z
        .enum(REGION_ENUM)
        .optional()
        .describe(
          "地域で絞る。'jp'=日本語圏（既定は全件）, 'intl'=海外すべて, " +
            "'us'/'uk'/'fr'/'de'/'it'/'nl'/'au'=国別, 'global'=国を跨ぐサービス",
        ),
    },
  },
  async ({ category, region }) =>
    guard(async () => {
      const hosts = LEGACY_HOSTS.filter(
        (h) =>
          (!category || h.category === category) &&
          (!region || matchesRegion(h, region)),
      );
      return {
        count: hosts.length,
        hint:
          "userPathHint はユーザー領域のパス形で、discover_sites に渡す prefix の組み立てに使う。" +
          "searchIndex='modern' のホストは現行検索では現代のページしか返らないので CDX 側の起点として使う。",
        hosts,
      };
    }),
);

server.registerTool(
  "build_retro_queries",
  {
    title: "レトロサイト向け検索クエリ生成（日本語圏・海外）",
    description:
      "現行の検索エンジン（Google / Bing 等）に投げるための、当時のホストを site: で絞り込んだ" +
      "クエリ群と、当時特有の言い回しを組み合わせた検索語を生成する。素のキーワードより命中率が上がる。" +
      "日本語圏は「リンクフリー」「キリ番」「相互リンク募集」「工事中」、" +
      "海外は \"Under Construction\" \"Sign my guestbook\" \"You are visitor number\" " +
      "\"Best viewed with Netscape\" などを使う（訳語では当たらないため個別に持っている）。" +
      "サービス終了済みのホストだけを対象にし、現行のショッピングサイトを除外する句を付けるため、" +
      "Yahoo!ショッピングや Amazon・eBay の商品ページに流れない。" +
      "海外を探すときは region='intl' を指定する（言い回しも自動で英語になる）。" +
      "生成されたクエリは WebSearch ツールへそのまま渡して使う。",
    inputSchema: {
      keyword: z
        .string()
        .describe(
          "探したい主題。例: '東方 CG 集' '個人 日記' 'amiga demoscene' 'star trek fan fiction'",
        ),
      region: z
        .enum(REGION_ENUM)
        .optional()
        .describe(
          "対象地域（既定 'jp'）。'intl'=海外すべて, 'us'/'uk'/'fr'/'de'/'it'/'nl'/'au'=国別, 'all'=日本＋海外。" +
            "言い回しの言語と除外する商業ドメインもこれに従う",
        ),
      categories: z
        .array(z.enum(["free-hosting", "isp-space", "university", "community"]))
        .optional()
        .describe("site: に含めるホスト種別。省略時は全部"),
      includePeriodPhrases: z
        .boolean()
        .optional()
        .describe("当時の言い回しを組み合わせたクエリも生成する（既定 true）"),
      includeModernHosts: z
        .boolean()
        .optional()
        .describe(
          "事業サイトが現役のドメイン（@nifty、OCN、ac.jp、btinternet.com、t-online.de 等）も" +
            "site: に含める（既定 false）。true にするとヒットの大半が現代のページになる",
        ),
    },
  },
  async ({
    keyword,
    categories,
    region = "jp",
    includePeriodPhrases = true,
    includeModernHosts = false,
  }) =>
    guard(async () => {
      const lang = phraseLangFor(region);
      const siteQueries = buildSiteQueries(keyword, categories, {
        includeModernHosts,
        region,
      });
      const phraseQueries = includePeriodPhrases
        ? buildPhraseQueries(keyword, { lang, region })
        : [];
      return {
        region,
        phraseLang: lang,
        siteQueries,
        phraseQueries,
        excludedDomains: noiseDomainsFor(region),
        periodPhrases: periodPhrases(lang),
        hint:
          "siteQueries は 1 本ずつ WebSearch に投げること（OR を繋げすぎると検索側に無視されます）。" +
          "ヒットしたらその URL を wayback_cdx_search と crawl_link_neighborhood に渡して掘り下げます。" +
          "なお当時のホストは現行検索の索引からほぼ消えているため、この経路の期待値は低いです。" +
          "実際に届くのは discover_sites → crawl_link_neighborhood の芋づるなので、そちらを主軸にしてください。" +
          (region === "jp"
            ? ""
            : " 海外の主題なら wiby_search（旧式ページ専門の全文検索）も併用してください。こちらは実際にヒットします。"),
      };
    }),
);

// ---------------------------------------------------------------------------
// 7. Wiby — 海外の古いサイトに対してだけ成立する全文検索
// ---------------------------------------------------------------------------
server.registerTool(
  "wiby_search",
  {
    title: "Wiby 全文検索（旧式ページ専門の検索エンジン）",
    description:
      "昔ながらの手打ちページだけを人手で選んで索引している検索エンジン Wiby を全文検索する。" +
      "現代の商業ページを構造的に含まないため、90年代〜2000年代前半の雰囲気を持つ" +
      "海外の個人サイトを『内容から』探せる。本サーバで唯一、全文検索が成立する経路。" +
      "【重要】索引対象は今も生きている旧式ページであり、アーカイブではない。" +
      "消えたサイトを探すなら wayback_* と併用する。日本語の索引はほぼ無いので英語で叩くこと。" +
      "1 回 12 件が上限でページングできない（続きが要るなら語を変えて呼び直す）。",
    inputSchema: {
      query: z
        .string()
        .describe("検索語（英語）。例: 'amiga demoscene' 'homemade rocketry' 'star trek fan page'"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(12)
        .optional()
        .describe("返す件数（既定 12 = サーバ側の上限）"),
    },
  },
  async ({ query, limit }) => guard(() => wibySearch(query, limit)),
);

// ---------------------------------------------------------------------------
// 8. Marginalia（海外の非商業サイト向け。URL 生成のみ）
// ---------------------------------------------------------------------------
server.registerTool(
  "marginalia_search_url",
  {
    title: "Marginalia 検索 URL 生成（独立系・非商業サイト優遇）",
    description:
      "商業性の低い個人サイトや古いページを優遇する独立系検索エンジン Marginalia の検索 URL を組み立てる。" +
      "海外（英語圏）の古い個人サイトを内容から探す用途に向く。" +
      "【制約】公式に英語専用で、日本語クエリでは結果が返らない。" +
      "またサービス移行中で HTML 構造が不安定なため、結果の自動取得は行わずブラウザでの閲覧を前提とする。" +
      "自動で結果まで欲しいときは wiby_search を使う（こちらは JSON API があり実際に取得できる）。" +
      "日本語の古いサイト本体を探す用途には使えない（wayback_* ツールを使うこと）。",
    inputSchema: {
      query: z.string().describe("検索語（英語のみ有効）"),
    },
  },
  async ({ query }) => guard(async () => buildMarginaliaQuery(query)),
);

// ---------------------------------------------------------------------------
// 9. NDL WARP（日本語サイト向け。URL 生成のみ）
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
// 10. 探索戦略ガイド — /drdr など、ツールだけ見て手順が分からない呼び出し元向け
// ---------------------------------------------------------------------------

/** 海外を探すときだけ差し込む手順。日本語圏との違いが大きい箇所に絞る。 */
const INTL_STEPS = [
  {
    step: "海外 1",
    action: "まず全文検索で当たりを取る（海外だけの特権）",
    tool: "wiby_search",
    detail:
      "Wiby は旧式の手打ちページだけを索引しているので、主題を英語 1〜2 語で叩くと" +
      "当時の空気のサイトが直接返る。日本語圏には同等の索引が存在しない。" +
      "ヒットしたサイトの URL をそのまま crawl_link_neighborhood の seeds へ渡して芋づるに接続する。",
  },
  {
    step: "海外 2",
    action: "GeoCities 本家のエリアを列挙する",
    tool: "discover_sites",
    detail:
      "例: url='www.geocities.com/Area51', from='1997', to='2001'。" +
      "本家は /<Neighborhood>/<番地>/ に加えて /<Neighborhood>/<Suburb>/<番地>/ の 3 階層がある" +
      "（実測: /Area51/Vault/1005/）。エリアは主題に対応していて、" +
      "Area51=SF・ゲーム, SoHo=アート, Athens=学術, Hollywood=映画, Heartland=家庭, " +
      "SiliconValley=技術, Tokyo=アジア文化, Paris=仏語, Vienna=クラシック音楽。" +
      "Angelfire は /<コード>/<ユーザー>/ の中間ディレクトリがあるが、discover_sites が" +
      "実データから判定して畳むのでホスト名だけ渡してよい。",
  },
  {
    step: "海外 3",
    action: "DMOZ / Yahoo! Directory 本家のカテゴリページを起点にする",
    tool: "wayback_cdx_search → crawl_link_neighborhood",
    detail:
      "例: url='dmoz.org/Recreation', from='1999', to='2003'。" +
      "DMOZ（2017 終了）は海外版の dir.yahoo.co.jp に当たる最大の人力名簿で、" +
      "カテゴリページ 1 枚から個人サイトの URL がまとめて取れる。" +
      "dir.yahoo.com（2014 終了）の 1996〜2000 年スナップショットも同様に効く。",
  },
  {
    step: "海外 4",
    action: "Web リングのハブから参加サイト一覧を取る",
    tool: "crawl_link_neighborhood",
    detail:
      "www.webring.org / www.ringsurf.com / www.bomis.com のリング一覧ページは、" +
      "同じ主題の個人サイトが数十件ずつ並ぶ。日本語圏の webring.ne.jp と同じ使い方。",
  },
  {
    step: "海外 5",
    action: "国別の ISP スペースへ降りる",
    tool: "legacy_hosts(region='uk'|'fr'|'de'|…) → discover_sites",
    detail:
      "欧州は ISP の寡占が強く、英=homepages.demon.co.uk / freespace.virgin.net、" +
      "独=home.t-online.de、仏=perso.wanadoo.fr / www.multimania.com / www.chez.com、" +
      "伊=digilander.iol.it、蘭=www.xs4all.nl/~。米国は members.aol.com と " +
      "ourworld.compuserve.com の比重が大きい。",
  },
];

server.registerTool(
  "retro_search_strategy",
  {
    title: "レトロサイト発掘の探索手順",
    description:
      "90年代の個人サイトなど、検索エンジンに載っていない古いマイナーサイトを探すための" +
      "手順書を返す。日本語圏と海外の双方に対応する。" +
      "どのツールをどの順で使うか迷ったとき、最初にこれを呼ぶ。",
    inputSchema: {
      topic: z.string().optional().describe("探したい主題（あれば手順を具体化する）"),
      region: z
        .enum(REGION_ENUM)
        .optional()
        .describe(
          "対象地域（既定 'jp'）。'intl' や国別を指定すると海外向けの手順・ホスト・言い回しに切り替わる",
        ),
    },
  },
  async ({ topic, region = "jp" }) =>
    guard(async () => ({
      region,
      principle:
        "90年代の個人サイトは『検索』ではなく『ディレクトリとリンク集とWebリング』で発見される設計だった。" +
        "したがって現代の全文検索を強化するのではなく、当時の発見経路をアーカイブ上で再生するのが唯一確実な方法。" +
        "これは日本語圏でも海外でも変わらない。違うのはホスト名・URL の階層・当時の言い回しで、" +
        "海外にだけ全文検索の抜け道（wiby_search）がある。",
      // 海外指定のときは、日本語圏と手順が異なる部分を先に置く
      steps: [
        ...(region === "jp" ? [] : INTL_STEPS),
        {
          step: 1,
          action: "起点となるホストを決める",
          tool: `legacy_hosts(region='${region}')`,
          detail:
            "主題に合う無料ホスティング／プロバイダを選ぶ。入口が欲しいなら category='community'" +
            "（日本語圏なら Yahoo!ディレクトリ・ReadMe!・日記才人・WebRing Japan、" +
            "海外なら DMOZ・dir.yahoo.com・WebRing・RingSurf）。" +
            "region を指定しないと日本語圏と海外が混ざって返る。",
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
            "エリア名が分からなければ url='www.geocities.co.jp' とホスト名だけでも呼べる（索引全体から散らして標本抽出し、実在したエリア名が siteRoot に出る）。" +
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
          action: "合致したサイトの『リンク』ページから 2〜3 段を上限付きで辿る",
          tool: "crawl_link_neighborhood",
          detail:
            "当時のサイトはほぼ必ずリンクページを持つ。seeds に起点 URL、timestamp に狙う年代、keywords に主題語を渡す。" +
            "既定 2 段、最大 3 段で、発見経路・アンカー・スナップショット・失敗・coverage がまとめて返る。",
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
        "Wayback の CDX は全文検索ではない。ページ内容からは探せないので、必ずドメインか URL 断片を先に手に入れる。" +
          "例外は wiby_search だけで、これは海外の生きている旧式ページに限られる。",
        "GeoCities は日本版と本家で URL の階層が違う。日本 /<エリア>/<番地>/ に対し、" +
          "本家は /<Neighborhood>/<Suburb>/<番地>/ の 3 階層がある。discover_sites は両方畳めるが、" +
          "prefix を手で組むときは Suburb の有無で結果が変わる。",
        "海外ホストは Angelfire の /<コード>/<ユーザー>/ のように、先頭 1 階層が『ユーザー』ではなく" +
          "『地区』のことがある。discover_sites は子ディレクトリの多さから地区を判定して 1 段深く畳むが、" +
          "サイト数が極端に少ない標本ではこの判定が働かないことがある（maxRecords を上げる）。",
        "海外の言い回しは訳語では当たらない。「工事中」→\"Under Construction\"、" +
          "「キリ番」→\"You are visitor number\"、「足跡帳」→\"Sign my guestbook\" のように定型文ごと違う。" +
          "build_retro_queries に region を渡すと自動で切り替わる。",
        "現行検索エンジンで当時のホストを site: 指定しても、索引から消えているためほぼ 0 件になる。" +
          "検索側はヒットが乏しいと絞り込みを緩めるので、放っておくと生きているショッピングサイトが返る" +
          "（実測: site:geocities.co.jp → Yahoo!ショッピング）。build_retro_queries が除外句を付けるが、" +
          "そもそも step 6 は補助であり、主力は step 2-b と step 5 の芋づる。",
        "discover_sites にホスト名だけを渡した結果は網羅ではなく標本（coverage.sampled=true）。" +
          "出てきたエリア名で呼び直すと、そのエリアは網羅に近づく。",
        "crawl_link_neighborhood の coverage.truncated=true は、pageBudget、candidateBudget、または linksPerPage の上限に触れた印。" +
          "reasons を見て必要な上限だけ増やすか、score の高い siteRoot を次の seeds にして探索を分割する。",
        "WARP は 2002 年以降の収集で、90年代はほぼ入っていない。90年代狙いなら Wayback 一択。",
        "Marginalia も Wiby も英語専用で、日本語クエリはほぼ 0 件。日本語圏では使わない。",
        "アーカイブに残っていても robots 除外やサーバ消滅で本文が取れないことがある。複数の年代のスナップショットを試す。",
        "文字コードは Shift_JIS / EUC-JP が主流。文字化けしたら raw=true で生 HTML を見て meta charset を確認する。",
      ],
      topicSpecific: topic
        ? region === "jp"
          ? `主題「${topic}」については、まず discover_sites か build_retro_queries で起点を得て、` +
            `crawl_link_neighborhood の seeds に URL、keywords に「${topic}」を渡して周辺サイトへ広げるのが速い。`
          : `主題「${topic}」については、まず wiby_search に英語 1〜2 語で投げて生きている旧式サイトを掴み、` +
            `その URL を crawl_link_neighborhood の seeds に入れて当時のリンク集へ遡るのが速い。` +
            `並行して discover_sites に www.geocities.com の主題に合うエリアを渡す。`
        : undefined,
    })),
);

const transport = new StdioServerTransport();
await server.connect(transport);
