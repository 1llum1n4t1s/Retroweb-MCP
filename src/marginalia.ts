/**
 * Marginalia Search 連携。
 *
 * 商業性の低い個人サイトや古いページを意図的に優遇する独立系検索エンジンで、
 * 思想としては本サーバの目的に非常に近い。ただし自動取得はしない。
 *
 * 【実測 2026-08 / スクレイプを断念した理由】
 *   1. 公式に英語専用。ヘルプに "does not support any languages other than English" と明記されており、
 *      日本語クエリは構造上ヒットしない（実測でも 0 件）。本サーバの主目的である
 *      日本語個人サイトの発掘には原理的に使えない。
 *   2. サービス移行中。search.marginalia.nu は marginalia-search.com へ 302 し、
 *      旧インターフェース old-search.marginalia.nu は 1KB 程度のスタブしか返さない。
 *      HTML 構造が安定しておらず、パーサを書いても短命になる。
 *
 * よって「常に 0 件を返す嘘のツール」を作らず、検索 URL の生成と用途の明示に留める。
 */

const SEARCH_BASE = "https://marginalia-search.com/search";

export interface MarginaliaQueryPlan {
  searchUrl: string;
  limitations: string[];
  goodFor: string[];
  alternatives: string[];
}

export function buildMarginaliaQuery(query: string): MarginaliaQueryPlan {
  const hasJapanese = /[぀-ヿ一-鿿]/.test(query);

  return {
    searchUrl: `${SEARCH_BASE}?${new URLSearchParams({ query })}`,
    limitations: [
      "Marginalia は公式に英語のみ対応で、日本語のクエリでは結果が返らない。",
      ...(hasJapanese
        ? [
            "⚠ 渡されたクエリに日本語が含まれています。このままではヒットしません。英語に置き換えるか、wayback_* ツールを使ってください。",
          ]
        : []),
      "結果の HTTP 取得は行わない設計。閲覧はブラウザで行うこと（サービス移行中で HTML 構造が不安定なため）。",
    ],
    goodFor: [
      "retro web / GeoCities / personal homepage といった英語の一次資料やアーカイブ運動の発見",
      "個人サイト保存プロジェクトや、当時を扱った英語圏のリンク集を探すこと",
    ],
    alternatives: [
      "日本語の古い個人サイトそのものを探すなら wayback_cdx_search と wayback_outlinks を使う。",
      "現行検索エンジンで粘るなら build_retro_queries で site: クエリを生成して WebSearch に渡す。",
    ],
  };
}
