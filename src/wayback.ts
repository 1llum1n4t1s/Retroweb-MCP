/**
 * Internet Archive Wayback Machine 連携。
 *
 * 90 年代の個人サイトは検索エンジンのインデックスから消えているため、
 * 「全文検索」ではなく「URL 空間の列挙（CDX）」と「保存済みページからのリンク辿り」が
 * 実際に到達できる唯一の経路になる。このモジュールはその 2 つを提供する。
 */

import { fetchHtml, fetchJson, fetchText } from "./http.js";

/**
 * 利用者が渡す URL はスキームを欠くことが多い（'geocities.co.jp/Playtown' など）。
 * URL コンストラクタは不正な base を与えると相対解決ごと例外になるため、
 * リンク抽出の前に必ずここを通して絶対 URL 化する。
 */
export function normalizeUrl(input: string): string {
  const unwrapped = unwrapWaybackUrl(input);
  return /^https?:\/\//i.test(unwrapped) ? unwrapped : `http://${unwrapped}`;
}

/** 完全な Wayback URL だけを元 URL へ戻し、通常 URL 内の /web/<数字>/ は維持する。 */
export function unwrapWaybackUrl(input: string): string {
  const trimmed = input.trim();
  return (
    trimmed.match(/^(?:https?:\/\/web\.archive\.org)?\/web\/\d+[a-z_]*\/(.+)$/i)?.[1] ??
    trimmed
  );
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
 * 走査に使う共通クエリを組み立てる（ページ指定と resumeKey 以外の部分）。
 */
function scanQuery(params: CdxSearchParams): URLSearchParams {
  const query = new URLSearchParams({
    url: params.url,
    output: "json",
    matchType: params.matchType ?? "prefix",
    fl: "original,timestamp,statuscode,mimetype",
    collapse: "urlkey",
  });
  const from = normalizeDate(params.from);
  const to = normalizeDate(params.to);
  if (from) query.set("from", from);
  if (to) query.set("to", to);
  if (params.onlyOk !== false) query.append("filter", "statuscode:200");
  if (params.mimeType) query.append("filter", `mimetype:${params.mimeType}`);
  return query;
}

/** CDX の 1 行を CdxRecord へ。ヘッダ行・resumeKey 行・空行は null で弾く。 */
function toRecord(row: string[]): CdxRecord | null {
  if (!Array.isArray(row) || row.length < 2 || !row[0] || !row[1]) return null;
  return {
    original: row[0],
    timestamp: row[1],
    statuscode: row[2] ?? "",
    mimetype: row[3] ?? "",
    snapshotUrl: snapshotUrl(row[1], row[0]),
  };
}

/**
 * CDX インデックスの総ブロック数を得る。
 *
 * ブロックは URL キー順に切られた索引の区画で、1 区画あたり実測 300〜1300 行。
 * `page=` を付けた取得はこの区画 1 つ分しか読まないため、対象がどれだけ巨大でも
 * サーバ側の処理が有界になる（＝タイムアウトしない）。
 */
async function cdxNumPages(params: CdxSearchParams): Promise<number> {
  const query = scanQuery(params);
  query.set("showNumPages", "true");
  // showNumPages は件数だけを平文で返す。output=json と fl を残すと
  // その指定が出力側に適用され、数字の代わりに '- - - -' が返る（実測）。
  query.delete("output");
  query.delete("fl");
  const body = await fetchText(`${CDX_ENDPOINT}?${query}`, { timeoutMs: 45_000 });
  const normalized = body.trim();
  if (!/^\d+$/.test(normalized)) {
    throw new Error(`CDX の総ブロック数が不正です: ${normalized}`);
  }
  return Number(normalized);
}

/** totalPages のうち want ページ分を、範囲全体へ均等に散らして選ぶ */
function spreadPages(totalPages: number, want: number): number[] {
  if (want >= totalPages) return Array.from({ length: totalPages }, (_, i) => i);
  // 端に寄せず等間隔に取る。ジオシティーズはエリア名の辞書順に並ぶため、
  // 先頭から順に取ると 1〜2 エリアだけで件数を使い切ってしまう。
  return Array.from({ length: want }, (_, i) =>
    Math.min(totalPages - 1, Math.floor(((i + 0.5) * totalPages) / want)),
  );
}

/**
 * 1 ブロックから実際に取れる行数の見積り。
 *
 * ブロックの生の行数は 300〜1300 だが、そこへ年代・ステータス・MIME の絞り込みが
 * 掛かるため手元に残るのはずっと少ない。ここを大きく見積もるとブロックを数枚しか
 * 読まずに終わり、ホスト全体を指定したときの収穫が激減する。
 */
const ROWS_PER_PAGE_ESTIMATE = 250;

/** 1 回の走査で読むブロック数の下限・上限（1 ブロックあたり実測 0.7〜1.7 秒） */
const MIN_SCAN_PAGES = 4;
const MAX_SCAN_PAGES = 24;

export interface ScanResult {
  records: CdxRecord[];
  /** direct=完全一致、paged=ブロック分割、resumeKey=旧来の継続キー */
  strategy: "direct" | "paged" | "resumeKey";
  /** CDX 索引の総ブロック数（対象の規模） */
  totalPages: number;
  /** 実際に読んだブロック数 */
  scannedPages: number;
  /** 全ブロックを読み切れず、間引いて標本抽出したか */
  sampled: boolean;
  /** 走査方法のフォールバックや一部取得失敗の説明 */
  note?: string;
}

/**
 * CDX を走査してレコードを集める。
 *
 * ホスト全体のような広い prefix を素の limit 付きクエリで叩くと、CDX が索引を
 * 端から舐めるためサーバ側が 60 秒で 504 を返す（`www.geocities.co.jp` の 1 年分で実測）。
 * ページ分割 API は 1 リクエストを 1 ブロックに限定するので、対象の広さに関わらず
 * 数秒で返る。ここではまず総ブロック数を得てから、範囲全体へ散らしてブロックを読む。
 */
async function cdxScan(
  params: CdxSearchParams,
  maxRecords: number,
  maxRequests = Math.min(
    MAX_SCAN_PAGES,
    Math.max(MIN_SCAN_PAGES, Math.ceil(maxRecords / ROWS_PER_PAGE_ESTIMATE)),
  ),
): Promise<ScanResult> {
  let totalPages: number | undefined;
  try {
    totalPages = await cdxNumPages(params);
  } catch {
    /* ページ分割 API が使えない場合は下の resumeKey 方式へ落ちる */
  }

  if (totalPages !== undefined) {
    if (totalPages === 0) {
      return {
        records: [],
        strategy: "paged",
        totalPages: 0,
        scannedPages: 0,
        sampled: false,
      };
    }

    // 予算いっぱいのブロックを範囲全体へ散らして選ぶ。
    const pages = spreadPages(totalPages, maxRequests);
    // 件数の予算はブロックへ均等に配る。前詰めで取ると、行数の多いブロックが
    // 数枚あるだけで予算を使い切り、結果が索引の狭い範囲（＝少数のエリア）に偏る。
    const perPage = Math.max(1, Math.ceil(maxRecords / pages.length));
    const records: CdxRecord[] = [];
    let scannedPages = 0;
    let failedPages = 0;
    let truncated = false;

    for (const page of pages) {
      if (records.length >= maxRecords) {
        truncated = true;
        break;
      }
      const query = scanQuery(params);
      query.set("page", String(page));

      // 1 ブロックが読めなくても走査全体は続ける（IA は個別ブロックで 5xx を返すことがある）。
      let rows: string[][];
      try {
        rows = await fetchJson<string[][]>(`${CDX_ENDPOINT}?${query}`);
      } catch {
        failedPages++;
        continue;
      }
      scannedPages++;
      if (!Array.isArray(rows) || rows.length < 2) continue;

      let taken = 0;
      for (const row of rows.slice(1)) {
        if (taken >= perPage || records.length >= maxRecords) {
          truncated = true;
          break;
        }
        const rec = toRecord(row);
        if (rec) {
          records.push(rec);
          taken++;
        }
      }
    }

    return {
      records,
      strategy: "paged",
      totalPages,
      scannedPages,
      sampled: scannedPages < totalPages || truncated,
      ...(failedPages > 0
        ? {
            note:
              `選択した ${pages.length} ブロック中 ${failedPages} ブロックを取得できませんでした。` +
              "総ブロック数は取得済みのため、先頭へ偏る resumeKey 方式には切り替えていません。",
          }
        : {}),
    };
  }

  return {
    ...(await cdxResumeScan(params, maxRecords, maxRequests)),
    note: "CDX のページ分割 API が使えなかったため resumeKey 方式で取得しました。対象が広いと途中で打ち切られることがあります。",
  };
}

/**
 * 旧来の resumeKey 走査。ページ分割 API が使えないときの退避経路。
 *
 * 索引の先頭から順に読むため、広い prefix では 504 になるか、
 * 返ってきても辞書順で先頭のエリアに偏る。
 */
async function cdxResumeScan(
  params: CdxSearchParams,
  maxRecords: number,
  maxPages: number,
): Promise<Omit<ScanResult, "note">> {
  const collected: CdxRecord[] = [];
  let resumeKey: string | undefined;
  let scannedPages = 0;
  let exhausted = false;

  for (let page = 0; page < maxPages && collected.length < maxRecords; page++) {
    const query = scanQuery(params);
    query.set("limit", String(Math.min(1000, maxRecords - collected.length)));
    query.set("showResumeKey", "true");
    if (resumeKey) query.set("resumeKey", resumeKey);

    const rows = await fetchJson<string[][]>(`${CDX_ENDPOINT}?${query}`);
    if (!Array.isArray(rows) || rows.length === 0) break;
    scannedPages++;

    if (rows.length === 1) {
      exhausted = true;
      break;
    }

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
      if (collected.length >= maxRecords) break;
      const rec = toRecord(row);
      if (rec) collected.push(rec);
    }

    if (!nextKey) {
      exhausted = true;
      break;
    }
    resumeKey = nextKey;
  }

  return {
    records: collected,
    strategy: "resumeKey",
    totalPages: 0,
    scannedPages,
    sampled: !exhausted,
  };
}

/**
 * 公開ツール向けの CDX 検索。
 * 完全一致は軽量な直接検索を保ち、prefix / host / domain は有界なブロック走査へ送る。
 */
export async function searchCdxCatalog(params: CdxSearchParams): Promise<ScanResult> {
  const matchType = params.matchType ?? "prefix";
  if (matchType === "exact") {
    return {
      records: await cdxSearch({ ...params, matchType }),
      strategy: "direct",
      totalPages: 0,
      scannedPages: 0,
      sampled: false,
    };
  }

  const maxRecords = Math.max(1, Math.abs(params.limit ?? 100));
  return cdxScan({ ...params, matchType }, maxRecords);
}

/**
 * URL から「個人サイトの根」を推定する。
 *
 * 当時の無料ホスティングはユーザーごとにディレクトリを割り当てていたため、
 * ファイル単位の URL をこの規則で畳むと「存在するサイトの一覧」が得られる。
 */
export function siteRootOf(rawUrl: string): string | null {
  return siteRootInfo(rawUrl)?.root ?? null;
}

/**
 * サイト根と、それをどの規則で決めたか。
 *
 * 規則が `generic`（先頭 1 階層をユーザー領域とみなした）ときだけ、後段の
 * {@link refineNeighborhoods} が実データを見て 1 段深く畳み直す余地がある。
 * チルダやジオシティーズは規則側で確定しているので触らせない。
 */
export function siteRootInfo(
  rawUrl: string,
): { root: string; rule: "tilde" | "numbered" | "generic" } | null {
  let u: URL;
  try {
    u = new URL(normalizeUrl(rawUrl));
  } catch {
    return null;
  }
  const host = u.host.replace(/:80$/, "");
  const segments = u.pathname.split("/").filter(Boolean);
  if (segments.length === 0) return null;

  // チルダ形式（大学・ISP に多い。日本も海外も共通）: /~username/
  const tilde = segments.findIndex((s) => s.startsWith("~"));
  if (tilde >= 0) {
    return {
      root: `http://${host}/${segments.slice(0, tilde + 1).join("/")}/`,
      rule: "tilde",
    };
  }

  // ジオシティーズ系: 番地（数字）までがひとつのサイト。
  //   日本   /<エリア名>/<番地>/                例: /Playtown-Bingo/1234/
  //   本家   /<Neighborhood>/<番地>/            例: /Area51/1002/
  //   本家   /<Neighborhood>/<Suburb>/<番地>/   例: /Area51/Vault/1005/
  // 番地を必須にするのは、これが無いものが /advertise/ /aboutgeo/ /addbook.html の
  // ようなサービス側のページ（＝個人サイトではない）だから。
  if (NUMBERED_ADDRESS_HOSTS.test(host)) {
    const idx = segments.findIndex((s, i) => i < 3 && /^\d+$/.test(s));
    return idx > 0
      ? { root: `http://${host}/${segments.slice(0, idx + 1).join("/")}/`, rule: "numbered" }
      : null;
  }

  // その他は先頭 1 階層をユーザー領域とみなす。
  // ただし先頭がファイル名（index.html 等）ならホスト直下の 1 枚ページで、
  // ユーザー領域ではないので数えない。
  if (FILE_SEGMENT_RE.test(segments[0])) return null;
  return { root: `http://${host}/${segments[0]}/`, rule: "generic" };
}

/**
 * 「番地」でユーザーを区切るホスト。
 *
 * ジオシティーズは日本版・本家・復元ミラーのいずれもこの形。本家には
 * `www5.geocities.com` のような連番ホストがあるため、末尾一致で拾う。
 */
const NUMBERED_ADDRESS_HOSTS = /(^|\.)(geocities\.(co\.jp|com)|oocities\.org)$/i;

/** 拡張子付きのパス片＝ディレクトリではなくファイル */
const FILE_SEGMENT_RE = /\.(html?|shtml|cgi|php|txt|gif|jpe?g|png|zip|lzh|pdf)$/i;

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

export interface DiscoverResult {
  sites: DiscoveredSite[];
  /** CDX 索引の総ブロック数。対象の規模を表す */
  totalPages: number;
  /** 実際に読んだブロック数 */
  scannedPages: number;
  /**
   * 全ブロックを読み切れず標本抽出になったか。
   * true のとき、返ったサイト一覧は網羅ではなく URL キー空間全体からの抜き取り。
   */
  sampled: boolean;
  note?: string;
}

/**
 * あるホスト／エリア配下に「どんな個人サイトが存在したか」を列挙する。
 *
 * 素の CDX 検索はファイル単位で返るため 1 サイトの画像群に埋もれてしまう。
 * ここではブロックを跨いで収集したうえでサイト根ごとに畳み、
 * 検索エンジンに載っていないサイトの一覧そのものを取り出す。
 *
 * ホスト名だけ（`www.geocities.co.jp`）のような広い指定でも落ちない。
 * 索引の走査は cdxScan がブロック単位に分割して行う。
 */
export async function discoverSites(params: {
  url: string;
  from?: string;
  to?: string;
  maxRecords?: number;
  htmlOnly?: boolean;
}): Promise<DiscoverResult> {
  const { url, from, to, maxRecords = 3000, htmlOnly = true } = params;

  const scan = await cdxScan(
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

  const assigned = assignRoots(scan.records);

  const grouped = new Map<string, DiscoveredSite>();
  for (const { root, rec } of assigned) {
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
  return {
    sites: [...grouped.values()].sort((a, b) => b.observedFiles - a.observedFiles),
    totalPages: scan.totalPages,
    scannedPages: scan.scannedPages,
    sampled: scan.sampled,
    note: scan.note,
  };
}

/**
 * 先頭 1 階層が「ユーザー」ではなく「地区」だと判定する閾値。
 *
 * 実測: Angelfire の `/on/` 配下には数百人が並ぶ一方、個人サイト 1 件が持つ
 * 直下ディレクトリは images / links / cgi-bin など数個に留まる。
 * 低くすると大きな個人サイトが分割され、高くすると地区が 1 サイトに潰れる。
 */
const NEIGHBORHOOD_MIN_CHILDREN = 8;

/**
 * 各レコードをサイト根へ割り当てる。
 *
 * 先頭 1 階層を機械的にユーザー領域とみなすと、Angelfire の `/on/<user>/` や
 * FortuneCity の `/<エリア>/<地区>/<番地>/` のような「中間ディレクトリを挟む」ホストで
 * 地区がまるごと 1 サイトに潰れる（`www.angelfire.com/on/` に数百人が同居する）。
 * 海外ホストはこの形が日本より多く、ホスト名の辞書を持っても取りこぼす。
 *
 * そこで規則で確定できなかった根（rule=generic）だけ、同じ根に何種類の
 * 子ディレクトリがぶら下がったかを実データから数え、閾値を超えたものを
 * 「地区」とみなして 1 段深く畳み直す。
 */
function assignRoots(records: CdxRecord[]): Array<{ root: string; rec: CdxRecord }> {
  const assigned: Array<{ root: string; rec: CdxRecord; child?: string }> = [];
  const childrenOf = new Map<string, Set<string>>();
  const directFilesOf = new Map<string, number>();

  for (const rec of records) {
    const info = siteRootInfo(rec.original);
    if (!info) continue;

    const child = info.rule === "generic" ? childDirUnder(rec.original, info.root) : undefined;
    assigned.push({ root: info.root, rec, child });
    if (info.rule !== "generic") continue;

    if (child) {
      const set = childrenOf.get(info.root) ?? new Set<string>();
      set.add(child);
      childrenOf.set(info.root, set);
    } else {
      directFilesOf.set(info.root, (directFilesOf.get(info.root) ?? 0) + 1);
    }
  }

  const neighborhoods = new Set(
    [...childrenOf.entries()]
      .filter(
        ([root, children]) =>
          children.size >= NEIGHBORHOOD_MIN_CHILDREN &&
          // 個人サイトも images/ pics/ 等を持つが、その場合は根の直下に
          // index.html・links.html… とファイルが並ぶ。地区の直下はほぼ空。
          children.size > (directFilesOf.get(root) ?? 0),
      )
      .map(([root]) => root),
  );

  return assigned
    .map(({ root, rec, child }) =>
      neighborhoods.has(root)
        ? child
          ? { root: `${root}${child}/`, rec }
          : // 地区そのものの直下にあるファイル（索引ページ等）は個人サイトではない
            null
        : { root, rec },
    )
    .filter((x): x is { root: string; rec: CdxRecord } => x !== null);
}

/**
 * 根の 1 つ下のディレクトリ名を返す。無い（＝根の直下のファイル）なら undefined。
 */
function childDirUnder(rawUrl: string, root: string): string | undefined {
  let path: string;
  try {
    path = new URL(normalizeUrl(rawUrl)).pathname;
  } catch {
    return undefined;
  }
  const rootPath = root.replace(/^https?:\/\/[^/]+/, "");
  if (!path.startsWith(rootPath)) return undefined;

  const rest = path.slice(rootPath.length).split("/").filter(Boolean);
  // 残りが 1 つだけなら、それはディレクトリ名ではなくファイル名
  if (rest.length < 2 || FILE_SEGMENT_RE.test(rest[0])) return undefined;
  return rest[0];
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
 * アクセント記号の名前付き実体参照を組み立てる。
 *
 * 欧州語のページは `&eacute;` `&uuml;` `&ccedil;` を多用し、当時のエディタは
 * 文字を直接書かずこの形で吐くものが多かった。1 件ずつ表に書くと 60 行を超えるので、
 * 「基底文字 ＋ 結合記号」を NFC 正規化して生成する。
 */
function buildAccentEntities(): Record<string, string> {
  const marks: Record<string, string> = {
    grave: "̀",
    acute: "́",
    circ: "̂",
    tilde: "̃",
    uml: "̈",
    ring: "̊",
    cedil: "̧",
  };
  const table: Record<string, string> = {};
  for (const [name, mark] of Object.entries(marks)) {
    for (const letter of "aeiouyncAEIOUYNC") {
      const composed = (letter + mark).normalize("NFC");
      // 合成できた組み合わせだけ採る（&ecedil; のような実在しない綴りを作らない）
      if (composed.length === 1) table[`${letter}${name}`] = composed;
    }
  }
  return table;
}

/**
 * 名前付き実体参照。数値参照と違い綴りを知らないと戻せない。
 *
 * 未対応のまま放置すると、フランス語・ドイツ語圏の古いページが
 * "la page demand&eacute;e" のまま本文に出てきて読めない（実測: perso.wanadoo.fr）。
 */
const NAMED_ENTITIES: Record<string, string> = {
  ...buildAccentEntities(),
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  szlig: "ß",
  aelig: "æ",
  AElig: "Æ",
  oslash: "ø",
  Oslash: "Ø",
  eth: "ð",
  thorn: "þ",
  copy: "©",
  reg: "®",
  trade: "™",
  deg: "°",
  plusmn: "±",
  times: "×",
  divide: "÷",
  frac12: "½",
  frac14: "¼",
  sup2: "²",
  sup3: "³",
  micro: "µ",
  para: "¶",
  sect: "§",
  middot: "·",
  laquo: "«",
  raquo: "»",
  iquest: "¿",
  iexcl: "¡",
  pound: "£",
  yen: "¥",
  euro: "€",
  cent: "¢",
  curren: "¤",
  ndash: "–",
  mdash: "—",
  lsquo: "'",
  rsquo: "'",
  ldquo: "“",
  rdquo: "”",
  bull: "•",
  hellip: "…",
  dagger: "†",
  permil: "‰",
  ordf: "ª",
  ordm: "º",
  shy: "",
};

/**
 * 実体参照を戻す。
 *
 * &amp; は最後に処理する（先に解くと &amp;#169; が © になってしまうため）。
 * 当時のページは記号を &#169; や &eacute; のように参照で書くことがあり、
 * 未処理のままだと本文テキストやリンクテキストにそのまま露出する。
 */
function decodeEntities(text: string): string {
  return text
    .replace(/&([a-z][a-z0-9]{1,7});/gi, (m, name: string) => {
      // 綴りは大小が意味を持つ（&Eacute; と &eacute;）ので完全一致を優先し、
      // &QUOT; のような全大文字表記だけ小文字へ丸めて拾う
      const hit = NAMED_ENTITIES[name] ?? NAMED_ENTITIES[name.toLowerCase()];
      return hit ?? m;
    })
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

export interface CrawlLinkNeighborhoodParams {
  /** 探索を始める当時の URL。リンク集・ディレクトリ・Web リングのハブが向く。 */
  seeds: string[];
  /** 各 URL でこの時点に最も近いスナップショットを選ぶ。省略時は最新。 */
  timestamp?: string;
  /** 辿るリンクの段数。Internet Archive への負荷を抑えるため最大 3。 */
  maxDepth?: number;
  /** 実際にスナップショットを解決してリンクを読むページ数。 */
  pageBudget?: number;
  /** 1 ページから採用するリンク数。 */
  linksPerPage?: number;
  /** 重複排除後に保持する URL 候補数（起点を含む）。 */
  candidateBudget?: number;
  /** 取得元と別ホストのリンクだけを辿る。 */
  externalOnly?: boolean;
  /** URL とアンカーテキストだけに適用する順位付け用キーワード。 */
  keywords?: string[];
}

export type CrawlPageStatus = "expanded" | "unavailable" | "failed";

export interface CrawlPageResult {
  url: string;
  siteRoot: string;
  depth: number;
  status: CrawlPageStatus;
  snapshotUrl?: string;
  snapshotTimestamp?: string;
  outlinkCount?: number;
  note?: string;
}

export interface CrawlSiteResult {
  siteRoot: string;
  /** このサイト根を代表する、実際にリンクされていた URL。 */
  sampleUrl: string;
  minDepth: number;
  seed: boolean;
  discoveredFrom?: string;
  anchorText: string;
  /** 起点から sampleUrl までの最短発見経路。 */
  route: string[];
  /** クロール中にこのサイト根へ向いたリンク数。 */
  references: number;
  /** URL またはアンカーテキストで一致したキーワード。本文検索ではない。 */
  keywordMatches: string[];
  /** keywordMatches×10 + 被参照数（最大5）+ 近い深さ、の単純な優先度。 */
  score: number;
  snapshot?: {
    originalUrl: string;
    archivedUrl?: string;
    timestamp: string;
  };
}

export interface CrawlFailure {
  url: string;
  depth: number;
  kind: "unavailable" | "fetch_error";
  message: string;
}

export interface CrawlLinkNeighborhoodResult {
  criteria: {
    seeds: string[];
    timestamp?: string;
    maxDepth: number;
    pageBudget: number;
    linksPerPage: number;
    candidateBudget: number;
    externalOnly: boolean;
    keywords: string[];
    scoring: string;
  };
  coverage: {
    pagesAttempted: number;
    pagesExpanded: number;
    pendingPages: number;
    uniqueUrls: number;
    uniqueSites: number;
    discoveredSites: number;
    skippedNonPageLinks: number;
    skippedCandidateLinks: number;
    pageLinkLimitHits: number;
    truncated: boolean;
    reasons: Array<"page_budget" | "candidate_budget" | "per_page_link_limit">;
  };
  /** 起点以外を先、score 降順、近い depth 順で並べる。 */
  sites: CrawlSiteResult[];
  /** 実際にページ予算を消費した URL と結果。 */
  pages: CrawlPageResult[];
  failures: CrawlFailure[];
}

type PendingPageStatus = "queued" | "discovered";

interface CrawlNode {
  url: string;
  siteRoot: string;
  depth: number;
  discoveredFrom?: string;
  anchorText: string;
  route: string[];
  status: PendingPageStatus | CrawlPageStatus;
  snapshotUrl?: string;
  snapshotTimestamp?: string;
  outlinkCount?: number;
  note?: string;
}

interface MutableCrawlSite {
  siteRoot: string;
  sampleUrl: string;
  minDepth: number;
  seed: boolean;
  discoveredFrom?: string;
  anchorText: string;
  route: string[];
  references: number;
  keywordMatches: Set<string>;
  sampleMatchCount: number;
  snapshot?: CrawlSiteResult["snapshot"];
}

const NON_PAGE_EXTENSION_RE =
  /\.(?:7z|avi|bmp|css|csv|docx?|eot|exe|flac|gif|ico|jpe?g|js|json|lzh|midi?|mov|mp3|mp4|mpeg|ogg|pdf|png|pptx?|rar|rss|svg|tar|tiff?|ttf|txt|wav|webm|webp|woff2?|xlsx?|xml|zip)$/i;

function boundedInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
  name: string,
): number {
  const actual = value ?? fallback;
  if (!Number.isInteger(actual) || actual < min || actual > max) {
    throw new Error(`${name} は ${min}〜${max} の整数で指定してください。`);
  }
  return actual;
}

/** ハッシュだけを落とし、クエリは Web リング等の識別に必要なので維持する。 */
function canonicalCrawlUrl(rawUrl: string): string | null {
  try {
    const url = new URL(normalizeUrl(rawUrl));
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

/** HTML を持たないことが明白な静的ファイルだけを探索対象から外す。 */
function isLikelyPageUrl(rawUrl: string): boolean {
  try {
    const pathname = new URL(rawUrl).pathname;
    return !NON_PAGE_EXTENSION_RE.test(pathname);
  } catch {
    return false;
  }
}

/** siteRootOf がホスト直下ページを返せない場合も、ホスト根へ安全に畳む。 */
function crawlSiteRoot(rawUrl: string): string {
  const inferred = siteRootOf(rawUrl);
  if (inferred) return inferred;
  const url = new URL(rawUrl);
  return `http://${url.host.replace(/:80$/, "")}/`;
}

function matchingKeywords(url: string, text: string, keywords: string[]): string[] {
  let decodedUrl = url;
  try {
    decodedUrl = decodeURIComponent(url);
  } catch {
    /* 壊れたパーセントエンコードは生 URL のまま照合する */
  }
  const haystack = `${decodedUrl} ${text}`.toLocaleLowerCase();
  return keywords.filter((keyword) => haystack.includes(keyword.toLocaleLowerCase()));
}

/**
 * 保存済みページのリンク近傍を、上限付き BFS で 2〜3 段だけ辿る。
 *
 * Internet Archive はレート制限が強いため、ページ取得は意図的に逐次実行する。
 * 個別 URL の失敗は収集して後続候補へ進み、全探索を 1 件の失敗で捨てない。
 */
export async function crawlLinkNeighborhood(
  params: CrawlLinkNeighborhoodParams,
): Promise<CrawlLinkNeighborhoodResult> {
  if (params.seeds.length < 1 || params.seeds.length > 5) {
    throw new Error("seeds は 1〜5 件で指定してください。");
  }

  const maxDepth = boundedInteger(params.maxDepth, 2, 1, 3, "maxDepth");
  const pageBudget = boundedInteger(params.pageBudget, 8, 1, 30, "pageBudget");
  const linksPerPage = boundedInteger(params.linksPerPage, 40, 1, 100, "linksPerPage");
  const candidateBudget = boundedInteger(
    params.candidateBudget,
    200,
    1,
    500,
    "candidateBudget",
  );
  const externalOnly = params.externalOnly ?? true;
  const keywords = [
    ...new Set((params.keywords ?? []).map((keyword) => keyword.trim()).filter(Boolean)),
  ];
  if (keywords.length > 10) throw new Error("keywords は 10 件以下で指定してください。");

  const seeds: string[] = [];
  for (const rawSeed of params.seeds) {
    const seed = canonicalCrawlUrl(rawSeed);
    if (!seed) throw new Error(`URL を解釈できません: '${rawSeed}'`);
    if (!seeds.includes(seed)) seeds.push(seed);
  }
  if (candidateBudget < seeds.length) {
    throw new Error(`candidateBudget は重複排除後の seeds 件数（${seeds.length}）以上にしてください。`);
  }

  const nodes = new Map<string, CrawlNode>();
  const sites = new Map<string, MutableCrawlSite>();
  const queue: string[] = [];
  const attempted: string[] = [];
  const failures: CrawlFailure[] = [];
  let pagesExpanded = 0;
  let skippedNonPageLinks = 0;
  let skippedCandidateLinks = 0;
  let pageLinkLimitHits = 0;

  const recordSite = (node: CrawlNode, seed: boolean, referenceIncrement: number): void => {
    const matches = matchingKeywords(node.url, node.anchorText, keywords);
    const current = sites.get(node.siteRoot);
    if (!current) {
      sites.set(node.siteRoot, {
        siteRoot: node.siteRoot,
        sampleUrl: node.url,
        minDepth: node.depth,
        seed,
        discoveredFrom: node.discoveredFrom,
        anchorText: node.anchorText,
        route: node.route,
        references: referenceIncrement,
        keywordMatches: new Set(matches),
        sampleMatchCount: matches.length,
      });
      return;
    }

    current.seed ||= seed;
    current.minDepth = Math.min(current.minDepth, node.depth);
    current.references += referenceIncrement;
    for (const match of matches) current.keywordMatches.add(match);

    // 同じサイトから複数 URL が出た場合、主題語を多く含む経路を代表例にする。
    if (matches.length > current.sampleMatchCount) {
      current.sampleUrl = node.url;
      current.discoveredFrom = node.discoveredFrom;
      current.anchorText = node.anchorText;
      current.route = node.route;
      current.sampleMatchCount = matches.length;
    }
  };

  for (const seed of seeds) {
    const node: CrawlNode = {
      url: seed,
      siteRoot: crawlSiteRoot(seed),
      depth: 0,
      anchorText: "",
      route: [seed],
      status: "queued",
    };
    nodes.set(seed, node);
    queue.push(seed);
    recordSite(node, true, 0);
  }

  while (queue.length > 0 && attempted.length < pageBudget) {
    const currentUrl = queue.shift();
    if (!currentUrl) break;
    const node = nodes.get(currentUrl);
    if (!node || node.status !== "queued") continue;

    attempted.push(currentUrl);
    let availability: AvailabilityResult;
    try {
      availability = await checkAvailability(currentUrl, params.timestamp);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      node.status = "failed";
      node.note = message;
      failures.push({ url: currentUrl, depth: node.depth, kind: "fetch_error", message });
      continue;
    }

    if (!availability.available || !availability.timestamp) {
      const message = availability.note ?? "指定時点付近のスナップショットが見つかりませんでした。";
      node.status = "unavailable";
      node.note = message;
      failures.push({ url: currentUrl, depth: node.depth, kind: "unavailable", message });
      continue;
    }

    node.snapshotUrl = availability.url;
    node.snapshotTimestamp = availability.timestamp;
    const site = sites.get(node.siteRoot);
    if (site && (!site.snapshot || site.sampleUrl === currentUrl)) {
      site.snapshot = {
        originalUrl: currentUrl,
        archivedUrl: availability.url,
        timestamp: availability.timestamp,
      };
    }

    try {
      // 上限より 1 件だけ多く見ることで、ちょうど上限件だった場合を「打ち切り」と誤判定しない。
      const extractedLinks = await extractOutlinks(currentUrl, availability.timestamp, {
        externalOnly,
        limit: linksPerPage + 1,
      });
      const links = extractedLinks.slice(0, linksPerPage);
      node.status = "expanded";
      node.outlinkCount = links.length;
      pagesExpanded++;
      if (extractedLinks.length > linksPerPage) pageLinkLimitHits++;

      for (const link of links) {
        const candidate = canonicalCrawlUrl(link.url);
        if (!candidate || !isLikelyPageUrl(candidate)) {
          skippedNonPageLinks++;
          continue;
        }

        const existing = nodes.get(candidate);
        if (existing) {
          recordSite(
            {
              ...existing,
              anchorText: link.text || existing.anchorText,
            },
            false,
            1,
          );
          continue;
        }

        if (nodes.size >= candidateBudget) {
          skippedCandidateLinks++;
          continue;
        }

        const depth = node.depth + 1;
        const candidateNode: CrawlNode = {
          url: candidate,
          siteRoot: crawlSiteRoot(candidate),
          depth,
          discoveredFrom: currentUrl,
          anchorText: link.text,
          route: [...node.route, candidate],
          status: depth < maxDepth ? "queued" : "discovered",
        };
        nodes.set(candidate, candidateNode);
        recordSite(candidateNode, false, 1);
        if (candidateNode.status === "queued") queue.push(candidate);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      node.status = "failed";
      node.note = message;
      failures.push({ url: currentUrl, depth: node.depth, kind: "fetch_error", message });
    }
  }

  const reasons: CrawlLinkNeighborhoodResult["coverage"]["reasons"] = [];
  if (queue.length > 0) reasons.push("page_budget");
  if (skippedCandidateLinks > 0) reasons.push("candidate_budget");
  if (pageLinkLimitHits > 0) reasons.push("per_page_link_limit");

  const siteResults = [...sites.values()]
    .map<CrawlSiteResult>((site) => {
      const keywordMatches = [...site.keywordMatches];
      return {
        siteRoot: site.siteRoot,
        sampleUrl: site.sampleUrl,
        minDepth: site.minDepth,
        seed: site.seed,
        discoveredFrom: site.discoveredFrom,
        anchorText: site.anchorText,
        route: site.route,
        references: site.references,
        keywordMatches,
        score:
          keywordMatches.length * 10 +
          Math.min(site.references, 5) +
          Math.max(0, maxDepth - site.minDepth),
        snapshot: site.snapshot,
      };
    })
    .sort((a, b) => {
      if (a.seed !== b.seed) return a.seed ? 1 : -1;
      return b.score - a.score || a.minDepth - b.minDepth || a.siteRoot.localeCompare(b.siteRoot);
    });

  const pageResults = attempted.flatMap<CrawlPageResult>((url) => {
    const node = nodes.get(url);
    if (!node || node.status === "queued" || node.status === "discovered") return [];
    return [
      {
        url: node.url,
        siteRoot: node.siteRoot,
        depth: node.depth,
        status: node.status,
        snapshotUrl: node.snapshotUrl,
        snapshotTimestamp: node.snapshotTimestamp,
        outlinkCount: node.outlinkCount,
        note: node.note,
      },
    ];
  });

  return {
    criteria: {
      seeds,
      timestamp: params.timestamp,
      maxDepth,
      pageBudget,
      linksPerPage,
      candidateBudget,
      externalOnly,
      keywords,
      scoring: "URL/アンカーテキストのキーワード一致×10 + 被参照数（最大5）+ 近い深さ",
    },
    coverage: {
      pagesAttempted: attempted.length,
      pagesExpanded,
      pendingPages: queue.length,
      uniqueUrls: nodes.size,
      uniqueSites: sites.size,
      discoveredSites: siteResults.filter((site) => !site.seed).length,
      skippedNonPageLinks,
      skippedCandidateLinks,
      pageLinkLimitHits,
      truncated: reasons.length > 0,
      reasons,
    },
    sites: siteResults,
    pages: pageResults,
    failures,
  };
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
