/**
 * 国立国会図書館インターネット資料収集保存事業（WARP）連携。
 *
 * 【重要な制約・実測 2026-08】
 * WARP は日本語サイトの保存で Internet Archive を補完する重要な資料源だが、
 * 現行サイト（warp.ndl.go.jp）は以下の理由で自動取得ができない。
 *
 *   1. 検索結果は JavaScript で描画され、HTML 応答に結果が一切含まれない
 *      （/search?keyword=... の応答 77KB 中、結果リンクは 0 件）
 *   2. 内部 API とみられる /api/search は CloudFront が 403 を返す
 *      （ブラウザ相当の UA / Referer / Accept を付けても変わらず）
 *
 * よって「検索結果を取得するツール」を作ると常に空を返す嘘のツールになる。
 * ここでは正しい検索 URL を組み立てて返すに留め、実際の閲覧は
 * ブラウザ（Claude の browser ツール等）で開いてもらう設計にしている。
 *
 * なお WARP の収集開始は 2002 年で、1990 年代のページは基本的に対象外である点も重要。
 * 90 年代を探すなら Wayback Machine が第一選択になる。
 */

const WARP_SEARCH = "https://warp.ndl.go.jp/search";

export interface WarpSearchTarget {
  /** インターネット公開の収集資料 */
  internet?: boolean;
  /** 館内限定公開の資料 */
  inLibrary?: boolean;
  /** 直近 5 年に収集されたもの */
  last5?: boolean;
}

export interface WarpQueryPlan {
  searchUrl: string;
  englishSearchUrl: string;
  limitations: string[];
  howTo: string[];
}

export function buildWarpQuery(
  keyword: string,
  target: WarpSearchTarget = { internet: true },
): WarpQueryPlan {
  const params = new URLSearchParams({ keyword });
  if (target.internet) params.append("target", "internet");
  if (target.inLibrary) params.append("target", "inlibrary");
  if (target.last5) params.append("target", "last5");

  return {
    searchUrl: `${WARP_SEARCH}?${params}`,
    englishSearchUrl: `https://warp.ndl.go.jp/en/search?${params}`,
    limitations: [
      "WARP の収集開始は 2002 年。1990 年代のページはほぼ収録されていないため、90 年代狙いなら Wayback Machine を使うこと。",
      "検索結果は JavaScript で描画されるため、HTTP 取得だけでは結果を読めない。ブラウザで開く必要がある。",
      "内部 API (/api/search) は 403 でブロックされており、プログラムからの直接取得はできない。",
    ],
    howTo: [
      "上記 searchUrl をブラウザで開く（Claude なら browser ツールの navigate → get_page_text）。",
      "WARP は「機関・団体のサイト」の保存が中心。個人サイトは公的機関に紐づくものを除き手薄。",
      "目当てのドメインが分かっているなら、キーワード欄に URL をそのまま入れると当該サイトの収集履歴が引ける。",
    ],
  };
}
