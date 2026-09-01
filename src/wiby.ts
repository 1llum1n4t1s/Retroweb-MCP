/**
 * Wiby 連携。
 *
 * Wiby は「昔ながらの手打ちページ」だけを人手で選んで索引している検索エンジンで、
 * 現代の商業ページを構造的に含まない。本サーバが扱う領域のうち、
 * **海外（主に英語圏）の古いサイトについてだけは全文検索が成立する**唯一の経路になる。
 *
 * 【実測 2026-08】
 *   - `https://wiby.me/json/?q=<query>` が JSON 配列を返す（要素は URL / Title / Snippet / Description）。
 *   - 1 リクエスト 12 件固定。`o=` などのオフセット指定は**空ボディ**を返し、ページングできない。
 *   - ヒット 0 件のときは空配列。
 *   - 索引しているのは「今も生きている」旧式ページで、アーカイブではない。
 *     消えたサイトを探す用途では wayback_* と併用する。
 *   - 日本語クエリは索引がほぼ無く実用にならない（英語で叩くこと）。
 */

import { fetchJson } from "./http.js";

const JSON_ENDPOINT = "https://wiby.me/json/";
const HTML_ENDPOINT = "https://wiby.me/";

/** 1 リクエストで返る件数（サーバ側固定） */
export const WIBY_PAGE_SIZE = 12;

export interface WibyResult {
  url: string;
  title: string;
  /** 本文からの抜粋（HTML 実体参照を含むことがある） */
  snippet: string;
  description: string;
}

export interface WibySearchResult {
  query: string;
  count: number;
  /** ブラウザで同じ検索を開くための URL */
  searchUrl: string;
  results: WibyResult[];
  note?: string;
}

/** Wiby の生応答。キーは大文字始まりで返る */
interface WibyRawItem {
  URL?: string;
  Title?: string;
  Snippet?: string;
  Description?: string;
}

/** 抜粋に混じる実体参照を戻す（&#39; などがそのまま入ってくる） */
function decode(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Wiby を全文検索する。
 *
 * ページングが無いので `limit` は 12 件の切り詰めにしかならない。
 * 件数を増やしたいときは語を変えて複数回呼ぶ。
 */
export async function wibySearch(
  query: string,
  limit = WIBY_PAGE_SIZE,
): Promise<WibySearchResult> {
  const trimmed = query.trim();
  const searchUrl = `${HTML_ENDPOINT}?${new URLSearchParams({ q: trimmed })}`;

  if (!trimmed) {
    return { query: trimmed, count: 0, searchUrl, results: [], note: "検索語が空です。" };
  }

  const raw = await fetchJson<WibyRawItem[]>(
    `${JSON_ENDPOINT}?${new URLSearchParams({ q: trimmed })}`,
  );

  const results: WibyResult[] = (Array.isArray(raw) ? raw : [])
    .filter((r) => r?.URL)
    .slice(0, Math.max(1, limit))
    .map((r) => ({
      url: r.URL ?? "",
      title: decode(r.Title ?? ""),
      snippet: decode(r.Snippet ?? ""),
      description: decode(r.Description ?? ""),
    }));

  const notes: string[] = [];
  if (results.length === 0) {
    notes.push(
      "0 件です。Wiby の索引は人手で選ばれた小規模なもので、語を 1〜2 語まで削ると当たりやすくなります。",
    );
  }
  if (/[぀-ヿ一-鿿]/.test(trimmed)) {
    notes.push(
      "⚠ 日本語クエリは Wiby の索引にほぼ存在しません。日本語サイトを探すなら discover_sites / crawl_link_neighborhood を使ってください。",
    );
  }
  if (results.length >= WIBY_PAGE_SIZE) {
    notes.push(
      `Wiby は 1 回 ${WIBY_PAGE_SIZE} 件が上限でページングできません。続きが要るときは語を変えて呼び直してください。`,
    );
  }

  return {
    query: trimmed,
    count: results.length,
    searchUrl,
    results,
    note: notes.length ? notes.join(" ") : undefined,
  };
}
