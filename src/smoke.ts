/**
 * 実 API に対する疎通確認スクリプト（開発用）。
 *
 * 外部サービスの仕様変更でツールが黙って空を返すのを防ぐため、
 * 各モジュールを実ネットワーク越しに 1 回ずつ叩いて件数を出す。
 * `pnpm smoke` で実行する。
 */

import { cdxSearch, checkAvailability, discoverSites, extractOutlinks, fetchArchivedPage, htmlToText, siteRootOf } from "./wayback.js";
import { buildMarginaliaQuery } from "./marginalia.js";
import { buildWarpQuery } from "./warp.js";
import { wibySearch } from "./wiby.js";
import {
  COMMERCIAL_NOISE_DOMAINS,
  COMMERCIAL_NOISE_DOMAINS_INTL,
  LEGACY_HOSTS,
  buildPhraseQueries,
  buildSiteQueries,
  periodPhrases,
} from "./legacy-domains.js";

let failures = 0;

async function check(name: string, fn: () => Promise<string>) {
  process.stdout.write(`\n[${name}] `);
  try {
    console.log(`OK — ${await fn()}`);
  } catch (err) {
    failures++;
    console.log(`FAIL — ${err instanceof Error ? err.message : String(err)}`);
  }
}

await check("cdxSearch (geocities.co.jp/Playtown 1999-2001)", async () => {
  const r = await cdxSearch({
    url: "geocities.co.jp/Playtown",
    matchType: "prefix",
    from: "1999",
    to: "2001",
    limit: 5,
  });
  if (r.length === 0) throw new Error("0 件");
  return `${r.length} 件 / 先頭: ${r[0].original} @ ${r[0].timestamp}`;
});

await check("cdxSearch (dir.yahoo.co.jp 1997-2000)", async () => {
  const r = await cdxSearch({
    url: "dir.yahoo.co.jp",
    matchType: "host",
    from: "1997",
    to: "2000",
    limit: 5,
  });
  if (r.length === 0) throw new Error("0 件");
  return `${r.length} 件 / 先頭: ${r[0].original} @ ${r[0].timestamp}`;
});

await check("checkAvailability (www.yahoo.co.jp @1997)", async () => {
  const r = await checkAvailability("www.yahoo.co.jp", "1997");
  if (!r.available) throw new Error("スナップショット無し");
  return `${r.timestamp} / ${r.url}`;
});

let sample: { url: string; timestamp: string } | undefined;

await check("fetchArchivedPage + htmlToText (www.yahoo.co.jp @1997)", async () => {
  const avail = await checkAvailability("www.yahoo.co.jp", "1997");
  if (!avail.timestamp) throw new Error("タイムスタンプ取得失敗");
  sample = { url: "www.yahoo.co.jp", timestamp: avail.timestamp };
  const html = await fetchArchivedPage(sample.url, sample.timestamp);
  const text = htmlToText(html, 400);
  if (html.length === 0) throw new Error("本文が空");
  // 文字コード推定が効いていれば日本語が読める。化けていれば U+FFFD が出る。
  if (text.includes("�")) {
    throw new Error(`文字化け（U+FFFD 検出）: ${text.slice(0, 80)}`);
  }
  if (!/[぀-ヿ一-鿿]/.test(text)) {
    throw new Error(`日本語が復号できていない: ${text.slice(0, 80)}`);
  }
  return `HTML ${html.length} 文字 / 日本語復号 OK: ${text.replace(/\s+/g, " ").slice(0, 70)}…`;
});

await check("extractOutlinks (Yahoo! JAPAN 1997 トップ)", async () => {
  if (!sample) throw new Error("前段のスナップショット取得が失敗しているため実行不可");
  const links = await extractOutlinks(sample.url, sample.timestamp, {
    externalOnly: false,
    limit: 50,
  });
  if (links.length === 0) throw new Error("リンク 0 件");
  return `${links.length} 件 / 例: ${links[0].text || "(no text)"} -> ${links[0].url}`;
});

await check("buildMarginaliaQuery (日本語入力には警告が付くこと)", async () => {
  const en = buildMarginaliaQuery("geocities personal homepage");
  if (!en.searchUrl.startsWith("https://marginalia-search.com/search?")) {
    throw new Error("URL 生成が不正");
  }
  const jp = buildMarginaliaQuery("個人ホームページ");
  if (!jp.limitations.some((l) => l.includes("⚠"))) {
    throw new Error("日本語クエリへの警告が出ていない");
  }
  return `${en.searchUrl} / 日本語警告あり`;
});

await check("buildWarpQuery", async () => {
  const p = buildWarpQuery("個人ホームページ");
  if (!p.searchUrl.startsWith("https://warp.ndl.go.jp/search?")) {
    throw new Error("URL 生成が不正");
  }
  return p.searchUrl;
});

await check("legacy hosts / query builder", async () => {
  const q = buildSiteQueries("日記", ["free-hosting"]);
  if (q.length === 0) throw new Error("クエリ生成 0 件");
  return `ホスト ${LEGACY_HOSTS.length} 件 / クエリ ${q.length} 本 / 例: ${q[0].slice(0, 80)}…`;
});

// --- 回帰チェック: 現行の商業サイトへ流れないこと ---
await check("buildSiteQueries (現役ドメインを既定で含めない)", async () => {
  const modern = LEGACY_HOSTS.filter((h) => h.searchIndex === "modern");
  if (modern.length === 0) throw new Error("modern 区分のホストが 1 件も無い");
  const joined = buildSiteQueries("日記").join(" ");
  const leaked = modern.filter((h) => joined.includes(`site:${h.domain} `) ||
    joined.includes(`site:${h.domain})`));
  if (leaked.length > 0) {
    throw new Error(`現役ドメインが混入: ${leaked.map((h) => h.domain).join(", ")}`);
  }
  return `retro ${LEGACY_HOSTS.length - modern.length} 件のみ使用 / modern ${modern.length} 件を除外`;
});

await check("buildSiteQueries / buildPhraseQueries (商業ドメイン除外句が付くこと)", async () => {
  const all = [...buildSiteQueries("日記"), ...buildPhraseQueries("日記", { count: 3 })];
  const missing = all.filter(
    (q) => !COMMERCIAL_NOISE_DOMAINS.every((d) => q.includes(`-site:${d}`)),
  );
  if (missing.length > 0) throw new Error(`除外句が欠けたクエリ ${missing.length} 本`);
  return `全 ${all.length} 本に ${COMMERCIAL_NOISE_DOMAINS.length} 件の除外句`;
});

// --- 海外向け: 地域指定でホスト・言い回し・除外句がまとめて切り替わること ---
await check("海外: 地域指定でクエリが切り替わること", async () => {
  const jp = buildSiteQueries("日記").join(" ");
  const intl = buildSiteQueries("fan page", undefined, { region: "intl" }).join(" ");
  if (intl.length === 0) throw new Error("海外向けクエリが 0 本");
  if (intl.includes("geocities.co.jp")) throw new Error("海外指定に日本のホストが混入");
  if (jp.includes("angelfire.com")) throw new Error("日本指定に海外のホストが混入");
  if (!intl.includes("site:www.geocities.com")) {
    throw new Error("GeoCities 本家が海外クエリに含まれていない");
  }
  const missing = COMMERCIAL_NOISE_DOMAINS_INTL.filter((d) => !intl.includes(`-site:${d}`));
  if (missing.length > 0) throw new Error(`海外向け除外句が欠落: ${missing.join(", ")}`);

  const en = buildPhraseQueries("fan page", { lang: "en", count: 3 });
  if (!en.some((q) => q.includes("Under Construction"))) {
    throw new Error("英語の言い回しが使われていない");
  }
  const intlHosts = LEGACY_HOSTS.filter((h) => h.region !== "jp");
  return `海外ホスト ${intlHosts.length} 件 / 英語の言い回し ${periodPhrases("en").length} 件 / クエリ ${buildSiteQueries("fan page", undefined, { region: "intl" }).length} 本`;
});

// --- 海外向け: URL 階層の違いを畳めること（純関数なので通信不要） ---
await check("海外: サイト根の判定（本家 GeoCities の 3 階層 / AOL / チルダ）", async () => {
  const cases: [string, string | null][] = [
    // 本家 GeoCities: Suburb を挟む 3 階層
    ["http://www.geocities.com/Area51/Vault/1005/index.html", "http://www.geocities.com/Area51/Vault/1005/"],
    // 本家 GeoCities: 2 階層
    ["http://www.geocities.com/Area51/1002/mail.html", "http://www.geocities.com/Area51/1002/"],
    // 連番ホストも同じ空間
    ["http://www5.geocities.com/Area51/Vault/1000/", "http://www5.geocities.com/Area51/Vault/1000/"],
    // 日本版（回帰確認）
    ["http://www.geocities.co.jp/Playtown-Bingo/1234/index.html", "http://www.geocities.co.jp/Playtown-Bingo/1234/"],
    // サービス側のページは個人サイトではない
    ["http://www.geocities.com/advertise/index.html", null],
    // AOL のスクリーンネーム
    ["http://members.aol.com/Brauliortz/amor.html", "http://members.aol.com/Brauliortz/"],
    // チルダ形式（海外 ISP・大学）
    ["http://homepages.demon.co.uk/~someone/page.html", "http://homepages.demon.co.uk/~someone/"],
  ];
  const bad = cases.filter(([input, expected]) => siteRootOf(input) !== expected);
  if (bad.length > 0) {
    throw new Error(
      bad.map(([i, e]) => `${i} → ${siteRootOf(i)}（期待: ${e}）`).join(" / "),
    );
  }
  return `${cases.length} パターン一致`;
});

// --- 海外の文字コード: 日本語向けの推定が西欧語を壊さないこと ---
await check("海外: 西欧語ページの復号（アクセント・実体参照）", async () => {
  const cases: [string, string, RegExp][] = [
    // ウムラウトが数個しか無い独語ページ。UTF-8 に倒すと U+FFFD になる
    ["home.t-online.de", "20010201192400", /führt/],
    // &eacute; 形式の名前付き実体参照を多用する仏語ページ
    ["www.chez.com", "20001212220300", /hébergement/],
  ];
  for (const [url, ts, expected] of cases) {
    const text = htmlToText(await fetchArchivedPage(url, ts), 2000);
    if (text.includes("�")) throw new Error(`${url}: 文字化け（U+FFFD）`);
    if (!expected.test(text)) {
      throw new Error(`${url}: ${expected} が復号できていない: ${text.replace(/\s+/g, " ").slice(0, 100)}`);
    }
  }
  return `${cases.length} 言語で復号 OK（独語ウムラウト / 仏語実体参照）`;
});

await check("海外: wibySearch（旧式ページの全文検索）", async () => {
  const r = await wibySearch("amiga demoscene");
  if (r.count === 0) throw new Error("0 件（索引か API の仕様変更を疑う）");
  if (!r.results[0].url.startsWith("http")) throw new Error("URL が不正");
  return `${r.count} 件 / 先頭: ${r.results[0].title.slice(0, 50)} → ${r.results[0].url}`;
});

await check("海外: wibySearch（日本語クエリに警告が付くこと）", async () => {
  const r = await wibySearch("個人ホームページ");
  if (!r.note?.includes("⚠")) throw new Error("日本語クエリへの警告が出ていない");
  return `警告あり / ${r.count} 件`;
});

// --- 回帰チェック: ホスト名だけの指定で落ちないこと ---
// 以前は CDX がホスト全体を端から舐めて 60 秒で 504 を返し、'fetch failed' になっていた。
await check("discoverSites (ホスト名だけ: www.geocities.co.jp)", async () => {
  const r = await discoverSites({
    url: "www.geocities.co.jp",
    from: "1997",
    to: "2002",
    maxRecords: 1500,
  });
  if (r.sites.length === 0) throw new Error("0 件");
  if (r.totalPages === 0) throw new Error("ページ分割 API が使われず旧方式へ落ちた");
  const areas = new Set(r.sites.map((s) => s.siteRoot.split("/")[3]));
  // 索引は URL キー順なので、散らして読めていなければエリアが 1〜2 種に偏る
  if (areas.size < 3) {
    throw new Error(`エリアが偏っている（${areas.size} 種）: ${[...areas].join(", ")}`);
  }
  return `${r.sites.length} サイト / ${areas.size} エリア / ${r.scannedPages}/${r.totalPages} ブロック`;
});

// --- 海外の実地: 本家 GeoCities のエリアからサイトを列挙できること ---
await check("海外: discoverSites (www.geocities.com/Area51)", async () => {
  const r = await discoverSites({
    url: "www.geocities.com/Area51",
    from: "1997",
    to: "2001",
    maxRecords: 1500,
  });
  if (r.sites.length === 0) throw new Error("0 件");
  // 番地まで畳めているか（/Area51/1002/ か /Area51/Vault/1005/ の形）
  const users = r.sites.filter((s) => /\/Area51(\/[^/]+)?\/\d+\/$/i.test(s.siteRoot));
  if (users.length === 0) {
    throw new Error(`ユーザー領域が畳めていない: ${r.sites.slice(0, 3).map((s) => s.siteRoot).join(", ")}`);
  }
  // パス部だけを数える（http: とホストを含めると全件が 3 階層に見える）
  const suburbs = users.filter(
    (s) => s.siteRoot.replace(/^https?:\/\/[^/]+/, "").split("/").filter(Boolean).length >= 3,
  );
  return `${r.sites.length} サイト（うち番地形 ${users.length} / Suburb 付き ${suburbs.length}） / 例: ${users[0].siteRoot}`;
});

// Angelfire は /<地区コード>/<ユーザー>/ なので、地区で潰れず個人単位に割れることを見る
await check("海外: discoverSites (www.angelfire.com — 地区の自動判定)", async () => {
  const r = await discoverSites({
    url: "www.angelfire.com",
    from: "1999",
    to: "2002",
    maxRecords: 2000,
  });
  if (r.sites.length === 0) throw new Error("0 件");
  const twoLevel = r.sites.filter(
    (s) => s.siteRoot.replace(/^https?:\/\/[^/]+/, "").split("/").filter(Boolean).length >= 2,
  );
  return `${r.sites.length} サイト / 2 階層に畳めたもの ${twoLevel.length} 件 / 例: ${(twoLevel[0] ?? r.sites[0]).siteRoot}`;
});

console.log(
  failures === 0
    ? "\n\n=== 全項目 OK ==="
    : `\n\n=== ${failures} 件 FAIL ===`,
);
process.exit(failures === 0 ? 0 : 1);
