/**
 * Internet Archive Wayback Machine 連携。
 *
 * 90 年代の個人サイトは検索エンジンのインデックスから消えているため、
 * 「全文検索」ではなく「URL 空間の列挙（CDX）」と「保存済みページからのリンク辿り」が
 * 実際に到達できる唯一の経路になる。このモジュールはその 2 つを提供する。
 */

import { fetchHtml, fetchJson } from "./http.js";

/**
 * 利用者が渡す URL はスキームを欠くことが多い（'geocities.co.jp/Playtown' など）。
 * URL コンストラクタは不正な base を与えると相対解決ごと例外になるため、
 * リンク抽出の前に必ずここを通して絶対 URL 化する。
 */
export function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  // web.archive.org 形式で渡された場合は元 URL を取り戻す
  const unwrapped =
    trimmed.match(/^(?:https?:\/\/web\.archive\.org)?\/web\/\d+[a-z_]*\/(.+)$/i)?.[1] ??
    trimmed;
  return /^https?:\/\//i.test(unwrapped) ? unwrapped : `http://${unwrapped}`;
}

const CDX_ENDPOINT = "https://web.archive.org/cdx/search/cdx";
const AVAILABILITY_ENDPOINT = "https://archive.org/wayback/available";
const WEB_BASE = "https://web.archive.org/web";

export interface CdxRecord {
  /** 元 URL（当時の生 URL） */
  original: string;
  /** 14 桁タイムスタンプ yyyyMMddHHmmss */
  timestamp: string;
  /** 保存時の HTTP ステータス */
  statuscode: string;
  mimetype: string;
  /** そのスナップショットを開く URL */
  snapshotUrl: string;
}

export interface CdxSearchParams {
  url: string;
  matchType?: "exact" | "prefix" | "host" | "domain";
  from?: string;
  to?: string;
  /** 取得件数。負値を渡すと「最新側から n 件」になる（CDX は既定で timestamp 昇順） */
  limit?: number;
  /** 同一 URL の重複スナップショットを 1 件に畳む */
  collapseUrls?: boolean;
  /** HTTP 200 のスナップショットのみに絞る */
  onlyOk?: boolean;
  mimeType?: string;
}

/** yyyy / yyyyMM / yyyyMMdd いずれの入力も CDX が受け付ける形に正規化する */
function normalizeDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const digits = value.replace(/\D/g, "");
  return digits.length > 0 ? digits : undefined;
}

export function snapshotUrl(timestamp: string, original: string): string {
  return `${WEB_BASE}/${timestamp}/${original}`;
}

/**
 * CDX API で、あるドメイン／パス配下に保存されている URL を列挙する。
 * これが「消えたサイトの目次」に相当する。
 */
export async function cdxSearch(params: CdxSearchParams): Promise<CdxRecord[]> {
  const {
    url,
    matchType = "prefix",
    from,
    to,
    limit = 100,
    collapseUrls = true,
    onlyOk = true,
    mimeType,
  } = params;

  const query = new URLSearchParams({
    url,
    output: "json",
    matchType,
    limit: String(limit),
    fl: "original,timestamp,statuscode,mimetype",
  });

  const fromNorm = normalizeDate(from);
  const toNorm = normalizeDate(to);
  if (fromNorm) query.set("from", fromNorm);
  if (toNorm) query.set("to", toNorm);
  if (collapseUrls) query.set("collapse", "urlkey");
  if (onlyOk) query.append("filter", "statuscode:200");
  if (mimeType) query.append("filter", `mimetype:${mimeType}`);

  const rows = await fetchJson<string[][]>(`${CDX_ENDPOINT}?${query}`);
  if (!Array.isArray(rows) || rows.length === 0) return [];

  // 1 行目はヘッダ。fl で指定した順に並ぶ。
  const [header, ...data] = rows;
  const idx = (name: string) => header.indexOf(name);
  const iOriginal = idx("original");
  const iTimestamp = idx("timestamp");
  const iStatus = idx("statuscode");
  const iMime = idx("mimetype");

  return data.map((row) => {
    const original = row[iOriginal] ?? "";
    const timestamp = row[iTimestamp] ?? "";
    return {
      original,
      timestamp,
      statuscode: row[iStatus] ?? "",
      mimetype: row[iMime] ?? "",
      snapshotUrl: snapshotUrl(timestamp, original),
    };
  });
}

/**
 * CDX を resumeKey で辿りながら、指定件数に達するまでレコードを集める。
 * prefix 検索は 1 サイトの画像群だけで limit を食い潰すため、
 * 「どんなサイトが存在するか」を知るには複数ページ分を舐める必要がある。
 */
async function cdxPaged(
  params: CdxSearchParams,
  maxRecords: number,
  maxPages = 10,
): Promise<CdxRecord[]> {
  const collected: CdxRecord[] = [];
  let resumeKey: string | undefined;

  for (let page = 0; page < maxPages && collected.length < maxRecords; page++) {
    const query = new URLSearchParams({
      url: params.url,
      output: "json",
      matchType: params.matchType ?? "prefix",
      limit: String(Math.min(1000, maxRecords - collected.length)),
      fl: "original,timestamp,statuscode,mimetype",
      collapse: "urlkey",
      showResumeKey: "true",
    });
    const from = normalizeDate(params.from);
    const to = normalizeDate(params.to);
    if (from) query.set("from", from);
    if (to) query.set("to", to);
    if (params.onlyOk !== false) query.append("filter", "statuscode:200");
    if (params.mimeType) query.append("filter", `mimetype:${params.mimeType}`);
    if (resumeKey) query.set("resumeKey", resumeKey);

    const rows = await fetchJson<string[][]>(`${CDX_ENDPOINT}?${query}`);
    if (!Array.isArray(rows) || rows.length < 2) break;

    const [, ...data] = rows;

    // resumeKey は「空行 + キー行」として末尾に付く
    let nextKey: string | undefined;
    const tail = data[data.length - 1];
    if (tail && tail.length === 1 && tail[0]) {
      nextKey = tail[0];
      data.pop();
      if (data.length > 0 && data[data.length - 1].every((c) => c === "")) data.pop();
    }

    for (const row of data) {
      if (row.length < 2 || !row[0]) continue;
      collected.push({
        original: row[0],
        timestamp: row[1],
        statuscode: row[2] ?? "",
        mimetype: row[3] ?? "",
        snapshotUrl: snapshotUrl(row[1], row[0]),
      });
    }

    if (!nextKey) break;
    resumeKey = nextKey;
  }

  return collected;
}

/**
 * URL から「個人サイトの根」を推定する。
 *
 * 当時の無料ホスティングはユーザーごとにディレクトリを割り当てていたため、
 * ファイル単位の URL をこの規則で畳むと「存在するサイトの一覧」が得られる。
 */
export function siteRootOf(rawUrl: string): string | null {
  let u: URL;
  try {
    u = new URL(normalizeUrl(rawUrl));
  } catch {
    return null;
  }
  const host = u.host.replace(/:80$/, "");
  const segments = u.pathname.split("/").filter(Boolean);
  if (segments.length === 0) return null;

  // チルダ形式（大学・ISP に多い）: /~username/
  const tilde = segments.findIndex((s) => s.startsWith("~"));
  if (tilde >= 0) return `http://${host}/${segments.slice(0, tilde + 1).join("/")}/`;

  // ジオシティーズ日本: /<エリア名>/<番地>/ の 2 階層でひとつのサイト
  if (/geocities\.co\.jp$/i.test(host)) {
    if (segments.length >= 2 && /^\d+$/.test(segments[1])) {
      return `http://${host}/${segments[0]}/${segments[1]}/`;
    }
    return `http://${host}/${segments[0]}/`;
  }

  // その他は先頭 1 階層をユーザー領域とみなす
  return `http://${host}/${segments[0]}/`;
}

export interface DiscoveredSite {
  siteRoot: string;
  /** 観測されたファイル数（サイトの規模感の目安） */
  observedFiles: number;
  /** サイト内で最も古いスナップショット（＝開設時期の上限） */
  earliest: string;
  /**
   * サイト内のファイルが最後に「新規に」観測された時刻。
   *
   * 列挙は CDX の collapse=urlkey（URL ごとに最初のキャプチャだけを残す）で行うため、
   * ここから各ファイルの再訪キャプチャは見えない。したがってこの値はサイトの最終更新でも
   * 最新キャプチャでもなく、「少なくともこの時点まで生きていた」という下限を表す。
   * 実際の最新キャプチャが必要なら、この siteRoot を wayback_snapshot に渡す。
   */
  latestFirstSeen: string;
  sampleUrl: string;
  sampleTimestamp: string;
}

/**
 * あるホスト／エリア配下に「どんな個人サイトが存在したか」を列挙する。
 *
 * 素の CDX 検索はファイル単位で返るため 1 サイトの画像群に埋もれてしまう。
 * ここではページを跨いで収集したうえでサイト根ごとに畳み、
 * 検索エンジンに載っていないサイトの一覧そのものを取り出す。
 */
export async function discoverSites(params: {
  url: string;
  from?: string;
  to?: string;
  maxRecords?: number;
  htmlOnly?: boolean;
}): Promise<DiscoveredSite[]> {
  const { url, from, to, maxRecords = 3000, htmlOnly = true } = params;

  const records = await cdxPaged(
    {
      url,
      matchType: "prefix",
      from,
      to,
      onlyOk: true,
      mimeType: htmlOnly ? "text/html" : undefined,
    },
    maxRecords,
  );

  const grouped = new Map<string, DiscoveredSite>();
  for (const rec of records) {
    const root = siteRootOf(rec.original);
    if (!root) continue;

    const existing = grouped.get(root);
    if (existing) {
      existing.observedFiles++;
      if (rec.timestamp < existing.earliest) existing.earliest = rec.timestamp;
      if (rec.timestamp > existing.latestFirstSeen) {
        existing.latestFirstSeen = rec.timestamp;
      }
    } else {
      grouped.set(root, {
        siteRoot: root,
        observedFiles: 1,
        earliest: rec.timestamp,
        latestFirstSeen: rec.timestamp,
        sampleUrl: rec.original,
        sampleTimestamp: rec.timestamp,
      });
    }
  }

  // ファイル数が多いサイトほど中身があった＝読む価値が高い
  return [...grouped.values()].sort((a, b) => b.observedFiles - a.observedFiles);
}

export interface AvailabilityResult {
  available: boolean;
  url?: string;
  timestamp?: string;
  status?: string;
  /** どちらの API で解決したか。availability が空を返した際の切り分け用。 */
  source?: "availability" | "cdx";
  note?: string;
}

/** 14 桁に満たないタイムスタンプを比較用に桁埋めする（'1997' → '19970101000000'） */
function padTimestamp(ts: string): number {
  return Number(ts.padEnd(14, "0").slice(0, 14));
}

/** 目標時点の前後それぞれから拾う近傍スナップショット数 */
const CDX_NEIGHBORS = 5;

/**
 * Availability API が使えないときに CDX から候補を取る。
 *
 * CDX は timestamp 昇順に返すため、素直に limit を掛けると「最も古い n 件」しか見えず、
 * 最新スナップショットにも目標時点の近傍にも届かない（キャプチャ数の多い URL ほど外す）。
 * 負の limit（最新側から取る）と from / to の窓で、必要な範囲だけを拾う。
 */
async function cdxNeighbors(target: string, ts?: string): Promise<CdxRecord[]> {
  const base = {
    url: target,
    matchType: "exact" as const,
    collapseUrls: false,
    onlyOk: true,
  };

  // 時点指定なし＝最新が欲しい。負の limit で末尾（最新側）から取る。
  if (!ts) return cdxSearch({ ...base, limit: -CDX_NEIGHBORS });

  // 目標時点の手前側と先側を別々に取り、距離比較は呼び出し側に任せる。
  // レート制限が疑われる状況で呼ばれる経路なので、並列化せず順に投げる。
  const before = await cdxSearch({ ...base, to: ts, limit: -CDX_NEIGHBORS });
  const after = await cdxSearch({ ...base, from: ts, limit: CDX_NEIGHBORS });
  return [...before, ...after];
}

/**
 * ある URL の、指定時点に最も近いスナップショットを 1 件だけ調べる。
 *
 * Availability API はレート制限時に 429 ではなく HTTP 200 と空の archived_snapshots を返す
 * （実測で確認）。ステータスコードでは検知できないサイレント失敗なので、
 * 空応答のときは信頼性の高い CDX API へフォールバックする。
 */
export async function checkAvailability(
  url: string,
  timestamp?: string,
): Promise<AvailabilityResult> {
  const target = normalizeUrl(url);
  const ts = normalizeDate(timestamp);

  const query = new URLSearchParams({ url: target });
  if (ts) query.set("timestamp", ts);

  try {
    const data = await fetchJson<{
      archived_snapshots?: {
        closest?: {
          available?: boolean;
          url?: string;
          timestamp?: string;
          status?: string;
        };
      };
    }>(`${AVAILABILITY_ENDPOINT}?${query}`);

    const closest = data?.archived_snapshots?.closest;
    if (closest?.available && closest.timestamp) {
      return {
        available: true,
        url: closest.url,
        timestamp: closest.timestamp,
        status: closest.status,
        source: "availability",
      };
    }
  } catch {
    /* CDX フォールバックへ進む */
  }

  // --- フォールバック: CDX で候補を取り、目標時点に最も近いものを選ぶ ---
  const records = await cdxNeighbors(target, ts);

  if (records.length === 0) {
    return {
      available: false,
      source: "cdx",
      note: "Availability API と CDX の双方でスナップショットが見つかりませんでした。URL の綴りやホスト名を見直してください。",
    };
  }

  const goal = ts ? padTimestamp(ts) : Number.MAX_SAFE_INTEGER;
  const best = records.reduce((a, b) =>
    Math.abs(padTimestamp(b.timestamp) - goal) <
    Math.abs(padTimestamp(a.timestamp) - goal)
      ? b
      : a,
  );

  return {
    available: true,
    url: best.snapshotUrl,
    timestamp: best.timestamp,
    status: best.statuscode,
    source: "cdx",
    note: "Availability API が空応答（レート制限の可能性）だったため CDX で解決しました。",
  };
}

/**
 * 保存済みページの本文を取得する。
 *
 * タイムスタンプに `id_` を付けると Wayback のツールバーが注入されない生の HTML が返るため、
 * リンク抽出やテキスト化ではこちらを使う。
 */
export async function fetchArchivedPage(
  url: string,
  timestamp: string,
): Promise<string> {
  // '1999-01-01' のような区切り付きで渡されると /web/1999-01-01id_/... という
  // 成立しないパスになるため、ここで桁だけに正規化してから組み立てる。
  const ts = normalizeDate(timestamp);
  if (!ts) {
    throw new Error(
      `タイムスタンプが数字を含みません: '${timestamp}'。cdx 検索や wayback_snapshot が返す 14 桁の timestamp をそのまま渡してください。`,
    );
  }
  const raw = `${WEB_BASE}/${ts}id_/${normalizeUrl(url)}`;
  // 当時のページは Shift_JIS / EUC-JP が主流なので、文字コード推定付きで取得する
  return fetchHtml(raw, { timeoutMs: 45_000 });
}

export interface OutlinkResult {
  /** 当時の絶対 URL に復元したリンク先 */
  url: string;
  /** アンカーテキスト（サイト名の手掛かりになる） */
  text: string;
  /** 取得元と別ホストか（＝外部サイトへの相互リンクか） */
  external: boolean;
}

/** Wayback の /web/<ts>/<original> 形式から元 URL を取り戻す */
function stripWaybackPrefix(href: string): string {
  const m = href.match(/^(?:https?:\/\/web\.archive\.org)?\/web\/\d+[a-z_]*\/(.+)$/i);
  return m ? m[1] : href;
}

/** 数値文字参照 1 個を文字へ。復号できない値は呼び出し側で原文のまま残す */
function fromCodePoint(n: number): string | undefined {
  if (!Number.isFinite(n) || n <= 0 || n > 0x10ffff) return undefined;
  if (n >= 0xd800 && n <= 0xdfff) return undefined; // 単独サロゲートは文字にならない
  try {
    return String.fromCodePoint(n);
  } catch {
    return undefined;
  }
}

/**
 * 実体参照を戻す。
 *
 * &amp; は最後に処理する（先に解くと &amp;#169; が © になってしまうため）。
 * 当時のページは記号を &#169; のような数値文字参照で書くことがあり、
 * 未処理のままだと本文テキストやリンクテキストにそのまま露出する。
 */
function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d{1,7});/g, (m, d) => fromCodePoint(Number(d)) ?? m)
    .replace(/&#x([0-9a-f]{1,6});/gi, (m, h) => fromCodePoint(parseInt(h, 16)) ?? m)
    .replace(/&amp;/g, "&");
}

// 90 年代の HTML はクォート無し属性（<A HREF=index.html>）も珍しくないため、
// ダブル / シングル / 無しの 3 形をすべて受ける。
const ATTR_VALUE = String.raw`\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s">]+))`;
const ANCHOR_RE = new RegExp(
  String.raw`<a\s[^>]*?href${ATTR_VALUE}[^>]*>([\s\S]*?)<\/a>`,
  "gi",
);
const AREA_RE = /<area\s[^>]*>/gi;
const FRAME_RE = /<(?:frame|iframe)\s[^>]*>/gi;
const BASE_RE = new RegExp(String.raw`<base\s[^>]*?href${ATTR_VALUE}`, "i");

/** タグ 1 個から属性値を取り出す（属性名の直前は必ず空白なので誤爆を避けられる） */
function pickAttr(tag: string, name: string): string {
  const m = tag.match(new RegExp(String.raw`\s${name}${ATTR_VALUE}`, "i"));
  return m ? decodeEntities((m[1] ?? m[2] ?? m[3] ?? "").trim()) : "";
}

/**
 * 相対リンクの解決基準を決める。
 *
 * フレーム配下のページやリンク集は <base href> でパスを付け替えていることがあり、
 * これを無視すると復元した絶対 URL が別ディレクトリ・別ホストを指す。
 */
function resolveLinkBase(html: string, pageUrl: string): string {
  const m = html.match(BASE_RE);
  const raw = m ? decodeEntities((m[1] ?? m[2] ?? m[3] ?? "").trim()) : "";
  if (!raw) return pageUrl;
  try {
    return new URL(stripWaybackPrefix(raw), pageUrl).toString();
  } catch {
    return pageUrl;
  }
}

/**
 * ページ内のリンク候補を集める。
 *
 * 当時のサイトはイメージマップ（<area>）とフレーム（<frame>）がナビゲーションの主役で、
 * アンカーが 1 つも無い frameset ページも珍しくない。<a> だけ見ると探索がそこで止まる。
 */
function collectLinkCandidates(html: string): Array<{ href: string; text: string }> {
  const candidates: Array<{ href: string; text: string }> = [];

  // アンカーを先に積む（従来どおり limit 内はアンカーが優先される）
  for (const m of html.matchAll(ANCHOR_RE)) {
    candidates.push({
      href: m[1] ?? m[2] ?? m[3] ?? "",
      text: (m[4] ?? "").replace(/<[^>]*>/g, ""),
    });
  }
  for (const m of html.matchAll(AREA_RE)) {
    candidates.push({ href: pickAttr(m[0], "href"), text: pickAttr(m[0], "alt") });
  }
  for (const m of html.matchAll(FRAME_RE)) {
    candidates.push({ href: pickAttr(m[0], "src"), text: pickAttr(m[0], "name") });
  }

  return candidates;
}

/**
 * 保存済みページから外部リンクを抽出する。
 *
 * 90 年代サイトの「リンク集」ページを起点に相互リンクを辿るための中核機能で、
 * 検索エンジンに載っていないサイトへ到達できる実質唯一の自動化手段。
 */
export async function extractOutlinks(
  pageUrl: string,
  timestamp: string,
  options: { externalOnly?: boolean; limit?: number } = {},
): Promise<OutlinkResult[]> {
  const { externalOnly = true, limit = 200 } = options;
  const base = normalizeUrl(pageUrl);
  const html = await fetchArchivedPage(base, timestamp);

  // 相対解決だけ <base href> に従う。外部判定は「取得元と別ホストか」なので取得元のまま。
  const linkBase = resolveLinkBase(html, base);

  let baseHost = "";
  try {
    baseHost = new URL(base).host.replace(/^www\./, "");
  } catch {
    /* 不正な URL でもリンク抽出自体は続行する */
  }

  const seen = new Set<string>();
  const results: OutlinkResult[] = [];

  for (const candidate of collectLinkCandidates(html)) {
    if (results.length >= limit) break;

    const rawHref = decodeEntities(candidate.href.trim());
    if (!rawHref || /^(#|javascript:|mailto:|data:)/i.test(rawHref)) continue;

    const stripped = stripWaybackPrefix(rawHref);

    let absolute: string;
    try {
      absolute = new URL(stripped, linkBase).toString();
    } catch {
      continue;
    }
    if (!/^https?:/i.test(absolute)) continue;

    let host: string;
    try {
      host = new URL(absolute).host.replace(/^www\./, "");
    } catch {
      continue;
    }
    // アーカイブ自身への内部リンクは成果ではないので除外する
    if (host === "web.archive.org" || host === "archive.org") continue;

    const external = baseHost !== "" && host !== baseHost;
    if (externalOnly && !external) continue;
    if (seen.has(absolute)) continue;
    seen.add(absolute);

    const text = decodeEntities(candidate.text).replace(/\s+/g, " ").trim();

    results.push({ url: absolute, text, external });
  }

  return results;
}

/** HTML をおおまかにプレーンテキスト化する（当時のページは装飾タグが多いため） */
export function htmlToText(html: string, maxChars = 8000): string {
  const text = decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return text.length > maxChars
    ? `${text.slice(0, maxChars)}\n…（${text.length - maxChars} 文字を省略）`
    : text;
}
