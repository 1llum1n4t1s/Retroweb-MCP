/**
 * 共通 HTTP クライアント。
 *
 * Internet Archive は無認証アクセスに対してしばしば 429 / 503 を返すため、
 * 指数バックオフ付きのリトライを必須とする（実測で素の 1 発叩きは頻繁に 429 になる）。
 */

const DEFAULT_UA =
  "Retroweb-MCP/0.1 (+https://github.com/1llum1n4t1s/Retroweb-MCP) archival-research";

/** リトライすべき HTTP ステータス（レート制限と一時的なサーバ側障害） */
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

/** Retry-After に従う場合の 1 回あたり上限。極端な指示で MCP 呼び出しを止めないため */
const MAX_RETRY_WAIT_MS = 30_000;

export interface FetchOptions {
  /** タイムアウト（ミリ秒） */
  timeoutMs?: number;
  /** リトライ回数（初回を除く） */
  retries?: number;
  /** 追加ヘッダ */
  headers?: Record<string, string>;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 読まないボディを破棄する。
 *
 * 未消費のままリトライへ進むと接続が解放されず、IA が 429 を返し続ける場面ほど
 * ソケットを掴んだまま再試行を重ねることになる。
 */
/**
 * Retry-After を待機ミリ秒へ。秒数と HTTP-date の両形式を受ける。
 *
 * IA は 429 でこのヘッダを返すことがあり、無視して 1s・2s・4s で叩き直すと
 * 制限が解けないまま試行回数だけを消費してしまう。
 */
function retryAfterMs(res: Response): number {
  const raw = res.headers.get("retry-after");
  if (!raw) return 0;
  const seconds = Number(raw.trim());
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(raw);
  return Number.isNaN(at) ? 0 : Math.max(0, at - Date.now());
}

/** 指数バックオフとサーバ指示の大きい方を採り、上限で頭打ちにする */
function retryDelay(attempt: number, hintMs: number): number {
  const backoff = 1000 * 2 ** (attempt - 1);
  return Math.min(Math.max(backoff, hintMs), MAX_RETRY_WAIT_MS);
}

/**
 * 通信エラーを、原因の分かるメッセージに書き換える。
 *
 * Node の fetch は接続断も DNS 失敗も一律 `fetch failed` としか言わず、
 * 中断（AbortError）に至っては呼び出し側のタイムアウトなのかサーバ側なのか区別できない。
 * 素通しすると利用者には「MCP が壊れている」ようにしか見えないため、ここで補う。
 */
function describeFetchError(err: unknown, url: string, timeoutMs: number): Error {
  if (err instanceof Error && err.name === "AbortError") {
    return new Error(
      `${timeoutMs / 1000} 秒以内に応答がありませんでした: ${url}。対象が広すぎてサーバ側が返しきれない可能性があります。`,
    );
  }
  if (err instanceof Error) {
    const cause = (err as { cause?: unknown }).cause;
    const detail =
      cause instanceof Error
        ? cause.message
        : cause !== undefined
          ? String(cause)
          : "";
    return detail ? new Error(`${err.message}（${detail}）: ${url}`) : err;
  }
  return new Error(String(err));
}

async function discardBody(res: Response): Promise<void> {
  try {
    await res.body?.cancel();
  } catch {
    /* 既に閉じている場合は無視してよい */
  }
}

/**
 * テキストを取得する。リトライ可能なステータスと通信エラーは指数バックオフで再試行し、
 * それでも駄目なら HttpError を投げる（呼び出し側が理由を利用者へ返せるようにするため）。
 */
export async function fetchText(
  url: string,
  options: FetchOptions = {},
): Promise<string> {
  const { timeoutMs = 30_000, retries = 3, headers = {} } = options;
  let lastError: Error | undefined;
  let waitHintMs = 0;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      // 1s, 2s, 4s ... と待つ。IA が Retry-After で指示してきたらそちらを優先する。
      await sleep(retryDelay(attempt, waitHintMs));
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": DEFAULT_UA, ...headers },
        signal: controller.signal,
        redirect: "follow",
      });

      if (RETRYABLE_STATUS.has(res.status)) {
        waitHintMs = retryAfterMs(res);
        await discardBody(res);
        lastError = new HttpError(
          res.status,
          url,
          `${res.status} ${res.statusText}`,
        );
        continue;
      }
      if (!res.ok) {
        await discardBody(res);
        throw new HttpError(res.status, url, `${res.status} ${res.statusText}`);
      }
      return await res.text();
    } catch (err) {
      if (err instanceof HttpError) throw err;
      lastError = describeFetchError(err, url, timeoutMs);
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError ?? new Error(`取得に失敗しました: ${url}`);
}

/**
 * バイト列から文字コードを推定して復号する。
 *
 * 90 年代〜2000 年代前半の日本語ページは Shift_JIS / EUC-JP が主流で、
 * charset メタタグを持たないものも多い（実測: 1997 年の Yahoo! JAPAN トップは meta 無し）。
 * res.text() は UTF-8 決め打ちのため、そのままでは本文が全て文字化けする。
 */
export function decodeHtml(buffer: ArrayBuffer, headerCharset?: string): string {
  const bytes = new Uint8Array(buffer);

  // 1. HTTP ヘッダの charset を最優先
  let charset = normalizeCharset(headerCharset);

  // 2. meta タグを ASCII 範囲で先読みする（charset 指定は必ず ASCII で書かれる）
  if (!charset) {
    const head = latin1(bytes.subarray(0, 4096));
    const meta =
      head.match(/<meta[^>]+charset\s*=\s*["']?\s*([a-z0-9_-]+)/i)?.[1] ??
      head.match(/charset\s*=\s*["']?\s*([a-z0-9_-]+)/i)?.[1];
    charset = normalizeCharset(meta);
  }

  // 3. 指定が無ければバイト分布から推定
  if (!charset) charset = detectJapaneseCharset(bytes);

  try {
    return new TextDecoder(charset, { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  }
}

function latin1(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
  return out;
}

function normalizeCharset(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  const v = value.toLowerCase().replace(/["']/g, "").trim();
  const map: Record<string, string> = {
    "shift-jis": "shift_jis",
    "shift_jis": "shift_jis",
    sjis: "shift_jis",
    "x-sjis": "shift_jis",
    "ms_kanji": "shift_jis",
    "windows-31j": "shift_jis",
    "cp932": "shift_jis",
    "euc-jp": "euc-jp",
    eucjp: "euc-jp",
    "x-euc-jp": "euc-jp",
    "iso-2022-jp": "iso-2022-jp",
    "utf-8": "utf-8",
    utf8: "utf-8",
    "iso-8859-1": "windows-1252",
    "us-ascii": "utf-8",
  };
  const hit = map[v];
  if (hit) return hit;
  // charset=Shift_JIS のように余計な語が混ざる場合に備えて部分一致も見る
  if (v.includes("shift")) return "shift_jis";
  if (v.includes("euc")) return "euc-jp";
  if (v.includes("2022")) return "iso-2022-jp";
  if (v.includes("utf")) return "utf-8";
  return undefined;
}

/**
 * Shift_JIS / EUC-JP / UTF-8 をバイト列から推定する。
 * それぞれの符号化で「妥当な多バイト列」がいくつ現れるかを数えて多数決する。
 */
function detectJapaneseCharset(bytes: Uint8Array): string {
  // ISO-2022-JP はエスケープシーケンスで一意に判別できる
  for (let i = 0; i + 2 < bytes.length; i++) {
    if (bytes[i] === 0x1b && bytes[i + 1] === 0x24 &&
        (bytes[i + 2] === 0x42 || bytes[i + 2] === 0x40)) {
      return "iso-2022-jp";
    }
  }

  let utf8 = 0;
  let sjis = 0;
  let euc = 0;
  let highBytes = 0;

  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b < 0x80) continue;
    highBytes++;

    const n1 = bytes[i + 1];

    // UTF-8: 2〜3 バイト列として妥当か
    if (b >= 0xc2 && b <= 0xdf && n1 >= 0x80 && n1 <= 0xbf) utf8 += 2;
    else if (b >= 0xe0 && b <= 0xef && n1 >= 0x80 && n1 <= 0xbf &&
             bytes[i + 2] >= 0x80 && bytes[i + 2] <= 0xbf) utf8 += 3;

    // EUC-JP: 両バイトとも 0xA1-0xFE
    if (b >= 0xa1 && b <= 0xfe && n1 >= 0xa1 && n1 <= 0xfe) euc += 2;
    // EUC-JP 半角カナ
    else if (b === 0x8e && n1 >= 0xa1 && n1 <= 0xdf) euc += 2;

    // Shift_JIS: 先頭 0x81-0x9F / 0xE0-0xEF、後続 0x40-0x7E / 0x80-0xFC
    if (((b >= 0x81 && b <= 0x9f) || (b >= 0xe0 && b <= 0xef)) &&
        n1 !== undefined &&
        ((n1 >= 0x40 && n1 <= 0x7e) || (n1 >= 0x80 && n1 <= 0xfc))) {
      sjis += 2;
    }
    // Shift_JIS 半角カナ（単独バイト）。EUC では現れない範囲。
    else if (b >= 0xa1 && b <= 0xdf) sjis += 1;
  }

  // 非 ASCII がほぼ無いなら UTF-8 扱いで問題ない
  if (highBytes < 4) return "utf-8";

  // 0x81-0x9F は EUC-JP には出現しないので、これが多ければ Shift_JIS 濃厚
  if (sjis > euc && sjis >= utf8) return "shift_jis";
  if (euc > sjis && euc >= utf8) return "euc-jp";
  return "utf-8";
}

/** 文字コードを推定しつつ HTML を取得する。アーカイブ済みページ用。 */
export async function fetchHtml(
  url: string,
  options: FetchOptions = {},
): Promise<string> {
  const { timeoutMs = 45_000, retries = 3, headers = {} } = options;
  let lastError: Error | undefined;
  let waitHintMs = 0;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(retryDelay(attempt, waitHintMs));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": DEFAULT_UA, ...headers },
        signal: controller.signal,
        redirect: "follow",
      });

      if (RETRYABLE_STATUS.has(res.status)) {
        waitHintMs = retryAfterMs(res);
        await discardBody(res);
        lastError = new HttpError(res.status, url, `${res.status} ${res.statusText}`);
        continue;
      }
      if (!res.ok) {
        await discardBody(res);
        throw new HttpError(res.status, url, `${res.status} ${res.statusText}`);
      }

      const headerCharset = res.headers
        .get("content-type")
        ?.match(/charset\s*=\s*([^;]+)/i)?.[1];
      return decodeHtml(await res.arrayBuffer(), headerCharset ?? undefined);
    } catch (err) {
      if (err instanceof HttpError) throw err;
      lastError = describeFetchError(err, url, timeoutMs);
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError ?? new Error(`取得に失敗しました: ${url}`);
}

/** JSON を取得する。Wayback CDX は配列の配列を返すため型は呼び出し側で絞る。 */
export async function fetchJson<T>(
  url: string,
  options: FetchOptions = {},
): Promise<T> {
  const body = await fetchText(url, {
    ...options,
    headers: { Accept: "application/json", ...options.headers },
  });
  const trimmed = body.trim();
  if (!trimmed) {
    // CDX はヒット 0 件のとき空ボディを返す（エラーではない）
    return [] as unknown as T;
  }
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    throw new Error(
      `JSON として解釈できない応答でした（先頭 200 文字）: ${trimmed.slice(0, 200)}`,
    );
  }
}
