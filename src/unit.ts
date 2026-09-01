/** 外部ネットワークを使わない回帰テスト。`pnpm unit` で実行する。 */

import assert from "node:assert/strict";

import { decodeHtml, fetchHtml, fetchText } from "./http.js";
import { buildPhraseQueries } from "./legacy-domains.js";
import { searchCdxCatalog, unwrapWaybackUrl } from "./wayback.js";

let failures = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`OK — ${name}`);
  } catch (error) {
    failures++;
    console.error(`FAIL — ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function withMockFetch(
  mock: (url: URL) => Response | Promise<Response>,
  fn: () => Promise<void>,
) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) =>
    mock(new URL(typeof input === "string" || input instanceof URL ? input : input.url))) as typeof fetch;
  try {
    await fn();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

await test("Wayback URL だけを元 URL へ戻す", () => {
  assert.equal(
    unwrapWaybackUrl(
      "https://web.archive.org/web/19990102030405id_/http://example.com/links.html",
    ),
    "http://example.com/links.html",
  );
  assert.equal(
    unwrapWaybackUrl("http://example.com/web/1999/page.html"),
    "http://example.com/web/1999/page.html",
  );
});

await test("宣言された西欧系 charset を推定より優先する", () => {
  const westernBytes = Uint8Array.from(Array.from({ length: 20 }, () => [0xe9, 0x61]).flat());
  for (const label of ["windows-1252", "cp1252", "latin1"]) {
    assert.equal(decodeHtml(westernBytes.buffer, label), "éa".repeat(20), label);
  }
  assert.equal(decodeHtml(Uint8Array.of(0xa4).buffer, "iso-8859-15"), "€");

  const metaHtml = Uint8Array.from(
    Buffer.from('<meta charset="cp1252"><p>caf\xe9</p>', "latin1"),
  );
  assert.equal(decodeHtml(metaHtml.buffer), '<meta charset="cp1252"><p>café</p>');
});

await test("region=all は日英を混ぜ、日本語既定は広告済み4句を含む", () => {
  const phraseOf = (query: string) => query.match(/^"([^"]+)"/)?.[1];
  const both = buildPhraseQueries("topic", { lang: "both" }).map(phraseOf);
  assert.deepEqual(both.slice(0, 8), [
    "リンクフリー",
    "Under Construction",
    "キリ番",
    "Sign my guestbook",
    "相互リンク募集",
    "You are visitor number",
    "工事中",
    "Best viewed with Netscape",
  ]);

  const jp = buildPhraseQueries("topic", { lang: "ja" }).map(phraseOf);
  for (const advertised of ["リンクフリー", "キリ番", "相互リンク募集", "工事中"]) {
    assert.ok(jp.includes(advertised), `${advertised} が日本語の既定8件に無い`);
  }
});

await test("HTTP 応答をバイト上限より先まで読み込まない", async () => {
  await withMockFetch(
    () => new Response("123456"),
    async () => {
      await assert.rejects(
        fetchHtml("https://web.archive.org/example", { maxBytes: 5, retries: 0 }),
        /サイズ上限 5 バイト/,
      );
      await assert.rejects(
        fetchText("https://web.archive.org/example", { maxBytes: 5, retries: 0 }),
        /サイズ上限 5 バイト/,
      );
    },
  );
});

await test("ページ数取得後のブロック失敗で resumeKey へ誤フォールバックしない", async () => {
  let resumeRequests = 0;
  await withMockFetch(
    (url) => {
      if (url.searchParams.get("showNumPages") === "true") return new Response("3");
      if (url.searchParams.has("page")) {
        return new Response("not found", { status: 404, statusText: "Not Found" });
      }
      if (url.searchParams.get("showResumeKey") === "true") resumeRequests++;
      return new Response("unexpected request", { status: 404, statusText: "Not Found" });
    },
    async () => {
      const result = await searchCdxCatalog({
        url: "example.com",
        matchType: "domain",
        limit: 100,
      });
      assert.equal(result.strategy, "paged");
      assert.equal(result.totalPages, 3);
      assert.equal(result.scannedPages, 0);
      assert.equal(result.sampled, true);
      assert.match(result.note ?? "", /3 ブロックを取得できません/);
      assert.equal(resumeRequests, 0);
    },
  );
});

await test("resumeKey が残る上限停止を標本として報告する", async () => {
  await withMockFetch(
    (url) => {
      if (url.searchParams.get("showNumPages") === "true") {
        return new Response("not available", { status: 404, statusText: "Not Found" });
      }
      if (url.searchParams.get("showResumeKey") === "true") {
        return Response.json([
          ["original", "timestamp", "statuscode", "mimetype"],
          ["http://example.com/", "19990102030405", "200", "text/html"],
          [""],
          ["next-key"],
        ]);
      }
      return new Response("unexpected request", { status: 404, statusText: "Not Found" });
    },
    async () => {
      const result = await searchCdxCatalog({
        url: "example.com",
        matchType: "host",
        limit: 1,
      });
      assert.equal(result.strategy, "resumeKey");
      assert.equal(result.records.length, 1);
      assert.equal(result.sampled, true);
    },
  );
});

await test("完全一致検索は直接検索の契約を維持する", async () => {
  let pageRequests = 0;
  await withMockFetch(
    (url) => {
      if (url.searchParams.has("page") || url.searchParams.has("showNumPages")) pageRequests++;
      return Response.json([
        ["original", "timestamp", "statuscode", "mimetype"],
        ["http://example.com/", "19990102030405", "200", "text/html"],
      ]);
    },
    async () => {
      const result = await searchCdxCatalog({
        url: "http://example.com/",
        matchType: "exact",
        limit: 1,
      });
      assert.equal(result.strategy, "direct");
      assert.equal(result.records.length, 1);
      assert.equal(result.sampled, false);
      assert.equal(pageRequests, 0);
    },
  );
});

if (failures > 0) process.exitCode = 1;
