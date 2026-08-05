/**
 * 実 API に対する疎通確認スクリプト（開発用）。
 *
 * 外部サービスの仕様変更でツールが黙って空を返すのを防ぐため、
 * 各モジュールを実ネットワーク越しに 1 回ずつ叩いて件数を出す。
 * `pnpm smoke` で実行する。
 */

import { cdxSearch, checkAvailability, extractOutlinks, fetchArchivedPage, htmlToText } from "./wayback.js";
import { buildMarginaliaQuery } from "./marginalia.js";
import { buildWarpQuery } from "./warp.js";
import { buildSiteQueries, LEGACY_HOSTS } from "./legacy-domains.js";

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

console.log(
  failures === 0
    ? "\n\n=== 全項目 OK ==="
    : `\n\n=== ${failures} 件 FAIL ===`,
);
process.exit(failures === 0 ? 0 : 1);
