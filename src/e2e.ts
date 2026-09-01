/**
 * MCP プロトコル越しの結合テスト（開発用）。
 *
 * ビルド済み dist/index.js を子プロセスとして起動し、実際の MCP クライアントから
 * ツール一覧と代表的な呼び出しを検証する。さらに本サーバの目的である
 * 「検索エンジンに載っていない個人サイトへ芋づるで到達できるか」を通しで確認する。
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["dist/index.js"],
});

const client = new Client({ name: "retroweb-e2e", version: "0.1.0" });
await client.connect(transport);

let failures = 0;

function parse(result: unknown): any {
  const content = (result as { content?: { type: string; text: string }[] }).content;
  const text = content?.[0]?.text ?? "";
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function call(name: string, args: Record<string, unknown>) {
  const res = await client.callTool({ name, arguments: args });
  if ((res as { isError?: boolean }).isError) {
    throw new Error(`ツール ${name} がエラー: ${parse(res)}`);
  }
  return parse(res);
}

async function check(name: string, fn: () => Promise<string>) {
  process.stdout.write(`\n[${name}] `);
  try {
    console.log(`OK — ${await fn()}`);
  } catch (err) {
    failures++;
    console.log(`FAIL — ${err instanceof Error ? err.message : String(err)}`);
  }
}

await check("tools/list", async () => {
  const { tools } = await client.listTools();
  const expected = [
    "wayback_cdx_search",
    "discover_sites",
    "wayback_snapshot",
    "wayback_fetch_page",
    "wayback_outlinks",
    "crawl_link_neighborhood",
    "legacy_hosts",
    "build_retro_queries",
    "wiby_search",
    "marginalia_search_url",
    "warp_search_url",
    "retro_search_strategy",
  ];
  const names = tools.map((t) => t.name);
  const missing = expected.filter((e) => !names.includes(e));
  if (missing.length) throw new Error(`未登録: ${missing.join(", ")}`);
  return `${tools.length} ツール登録済み`;
});

await check("retro_search_strategy", async () => {
  const r = await call("retro_search_strategy", { topic: "個人 日記サイト" });
  if (!Array.isArray(r.steps) || r.steps.length < 5) throw new Error("手順が不足");
  if (!(r.steps as { tool: string }[]).some((step) => step.tool === "crawl_link_neighborhood")) {
    throw new Error("複数段の芋づる手順が新ツールへ切り替わっていない");
  }
  return `${r.steps.length} ステップ / 落とし穴 ${r.pitfalls.length} 件`;
});

await check("legacy_hosts (community)", async () => {
  const r = await call("legacy_hosts", { category: "community" });
  if (r.count === 0) throw new Error("0 件");
  return `${r.count} 件 / 例: ${r.hosts[0].domain}`;
});

await check("build_retro_queries", async () => {
  const r = await call("build_retro_queries", { keyword: "自作CG" });
  if (!r.siteQueries?.length) throw new Error("site: クエリ 0 本");
  if (!r.phraseQueries?.length) throw new Error("言い回しクエリ 0 本");
  return `site: ${r.siteQueries.length} 本 / 言い回し ${r.phraseQueries.length} 本`;
});

// --- 本命: 実際に無名の個人サイトへ到達できるかを通しで確認する ---
await check("実地: ジオシティーズ配下の個人サイト列挙", async () => {
  const r = await call("wayback_cdx_search", {
    url: "www.geocities.co.jp/Playtown",
    matchType: "prefix",
    from: "1998",
    to: "2001",
    limit: 30,
    mimeType: "text/html",
  });
  if (r.count === 0) throw new Error("0 件");
  const coverage = r.coverage as { strategy?: string; sampled?: boolean } | undefined;
  if (!coverage || coverage.strategy === "direct") {
    throw new Error("広い CDX 検索が分割走査になっていない");
  }
  const users = (r.records as { original: string }[])
    .map((x) => x.original.match(/Playtown\/(\d+)/)?.[1])
    .filter(Boolean);
  return `${r.count} 件 / ${coverage.strategy} / 個人ID 例: ${[...new Set(users)].slice(0, 5).join(", ")}`;
});

await check("実地: 無名の個人サイトを列挙できるか（本サーバの中核）", async () => {
  const r = await call("discover_sites", {
    url: "www.geocities.co.jp/Playtown-Bingo",
    from: "1998",
    to: "2002",
    maxRecords: 2000,
    limit: 10,
  });
  if (r.totalSites === 0) throw new Error("0 サイト");
  const sites = r.sites as { siteRoot: string; observedFiles: number }[];
  // 個人ユーザーの領域（<エリア>/<番地>/）が取れていることを確認する
  const userSites = sites.filter((s) => /\/Playtown-Bingo\/\d+\/$/.test(s.siteRoot));
  if (userSites.length === 0) {
    throw new Error(`ユーザー領域が畳めていない: ${sites.slice(0, 3).map((s) => s.siteRoot).join(", ")}`);
  }
  return `${r.totalSites} サイト / 例: ${userSites.slice(0, 3).map((s) => `${s.siteRoot}(${s.observedFiles}files)`).join(", ")}`;
});

await check("実地: 個人サイト本文の日本語取得", async () => {
  const list = await call("wayback_cdx_search", {
    url: "www.geocities.co.jp/Playtown",
    matchType: "prefix",
    from: "1998",
    to: "2001",
    limit: 40,
    mimeType: "text/html",
  });
  const records = list.records as { original: string; timestamp: string }[];

  // トップページらしきものを優先して、日本語本文が取れるまで数件試す
  for (const rec of records.slice(0, 12)) {
    try {
      const page = await call("wayback_fetch_page", {
        url: rec.original,
        timestamp: rec.timestamp,
        maxChars: 600,
      });
      const text = String(page.content ?? "");
      if (/[぀-ヿ一-鿿]/.test(text) && !text.includes("�")) {
        return `${rec.original} @ ${rec.timestamp} → ${text.replace(/\s+/g, " ").slice(0, 70)}…`;
      }
    } catch {
      /* 個別ページの取得失敗は想定内。次の候補へ */
    }
  }
  throw new Error("日本語本文を取得できるページが見つからなかった");
});

await check("実地: リンク集からの芋づる（別ホストへ到達できるか）", async () => {
  // Yahoo! JAPAN の 1997 年ディレクトリは当時の個人サイト名簿として機能していた
  const snap = await call("wayback_snapshot", {
    url: "www.yahoo.co.jp",
    timestamp: "1997",
  });
  const links = await call("wayback_outlinks", {
    url: "www.yahoo.co.jp",
    timestamp: snap.timestamp,
    externalOnly: false,
    limit: 200,
  });
  if (links.count === 0) throw new Error("リンク 0 件");
  return `${links.count} リンク / ${links.distinctHosts} ホスト / 例: ${links.hosts.slice(0, 4).join(", ")}`;
});

await check("実地: 予算付きリンク近傍クロール", async () => {
  const result = await call("crawl_link_neighborhood", {
    seeds: ["www.yahoo.co.jp"],
    timestamp: "1997",
    maxDepth: 2,
    pageBudget: 1,
    linksPerPage: 20,
    candidateBudget: 25,
    externalOnly: false,
    keywords: ["Yahoo"],
  });
  const candidate = (result.sites as { seed: boolean; route: string[] }[]).find(
    (site) => !site.seed,
  );
  if (!candidate) throw new Error("起点以外の候補サイトが 0 件");
  if (candidate.route.length < 2) throw new Error("起点からの経路が無い");
  if (result.coverage.pagesAttempted !== 1) throw new Error("pageBudget を超過");
  if (!result.coverage.reasons.includes("page_budget")) {
    throw new Error("打ち切り理由に page_budget が無い");
  }
  return `${result.coverage.discoveredSites} サイト / ${result.coverage.uniqueUrls} URL`;
});

// --- 海外の発掘が通しで成立するか ---
await check("海外: 手順・ホスト辞書が地域で切り替わること", async () => {
  const strategy = await call("retro_search_strategy", {
    topic: "amiga demoscene",
    region: "intl",
  });
  const tools = (strategy.steps as { tool: string }[]).map((s) => s.tool).join(" ");
  if (!tools.includes("wiby_search")) throw new Error("海外手順に wiby_search が出てこない");

  const hosts = await call("legacy_hosts", { region: "intl" });
  if (hosts.count === 0) throw new Error("海外ホストが 0 件");
  const jpLeak = (hosts.hosts as { region: string }[]).filter((h) => h.region === "jp");
  if (jpLeak.length > 0) throw new Error(`region='intl' に日本のホストが混入: ${jpLeak.length} 件`);

  const q = await call("build_retro_queries", { keyword: "fan page", region: "intl" });
  if (q.phraseLang !== "en") throw new Error(`言い回しが英語になっていない: ${q.phraseLang}`);
  return `手順 ${strategy.steps.length} ステップ / 海外ホスト ${hosts.count} 件 / 英語クエリ ${q.siteQueries.length}+${q.phraseQueries.length} 本`;
});

await check("実地: 海外の無名個人サイトを列挙できるか", async () => {
  const r = await call("discover_sites", {
    url: "www.geocities.com/SoHo",
    from: "1997",
    to: "2001",
    maxRecords: 1500,
    limit: 10,
  });
  if (r.totalSites === 0) throw new Error("0 サイト");
  const sites = r.sites as { siteRoot: string; observedFiles: number }[];
  const users = sites.filter((s) => /\/SoHo(\/[^/]+)?\/\d+\/$/i.test(s.siteRoot));
  if (users.length === 0) {
    throw new Error(`番地まで畳めていない: ${sites.slice(0, 3).map((s) => s.siteRoot).join(", ")}`);
  }
  return `${r.totalSites} サイト / 例: ${users.slice(0, 3).map((s) => `${s.siteRoot}(${s.observedFiles}files)`).join(", ")}`;
});

await check("実地: 海外の旧式ページを全文検索して芋づるへ繋げるか", async () => {
  const hit = await call("wiby_search", { query: "amiga demoscene", limit: 5 });
  if (hit.count === 0) throw new Error("0 件");
  return `${hit.count} 件 / 先頭: ${hit.results[0].title.slice(0, 40)} → ${hit.results[0].url}`;
});

await check("エラー処理: 存在しないドメインで例外にならないこと", async () => {
  const r = await call("wayback_cdx_search", {
    url: "this-domain-should-not-exist-retroweb-test.example",
    limit: 5,
  });
  if (r.count !== 0) throw new Error("想定外にヒットした");
  if (!r.hint) throw new Error("0 件時のヒントが無い");
  return "0 件でヒントを返した";
});

await client.close();

console.log(
  failures === 0
    ? "\n\n=== E2E 全項目 OK ==="
    : `\n\n=== E2E ${failures} 件 FAIL ===`,
);
process.exit(failures === 0 ? 0 : 1);
