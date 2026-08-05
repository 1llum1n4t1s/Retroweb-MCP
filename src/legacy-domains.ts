/**
 * 90 年代〜2000 年代前半の日本語個人サイトが置かれていたホスティング領域の辞書。
 *
 * 当時の個人サイトはほぼ全て「プロバイダのおまけスペース」か「無料ホームページサービス」に
 * 置かれていた。現行検索エンジンでも、この既知ドメインで site: 絞り込みをすると
 * 素のキーワード検索より格段に当たる。CDX の探索起点としても使う。
 */

export interface LegacyHost {
  /** ホスト名（CDX / site: にそのまま使える） */
  domain: string;
  /** 提供元の呼称 */
  provider: string;
  category: "free-hosting" | "isp-space" | "university" | "community";
  /** 個人サイトが置かれた典型的なパス形（CDX の prefix 検索に使う） */
  userPathHint?: string;
  note?: string;
}

export const LEGACY_HOSTS: LegacyHost[] = [
  // --- 無料ホームページサービス（個人サイトの最大母数） ---
  {
    domain: "geocities.co.jp",
    provider: "ジオシティーズ（Yahoo! JAPAN）",
    category: "free-hosting",
    userPathHint: "/<エリア名>/<番地>/ 例: /Playtown/1234/",
    note: "2019/03 サービス終了。日本語個人サイト最大の墓場。エリア名は Playtown / Hollywood / SiliconValley / Milano / Berkeley など",
  },
  {
    domain: "www.geocities.jp",
    provider: "ジオシティーズ（後期ドメイン）",
    category: "free-hosting",
    userPathHint: "/<ユーザーID>/",
    note: "2000 年代以降のアカウントはこちら",
  },
  {
    domain: "tripod.co.jp",
    provider: "Tripod Japan",
    category: "free-hosting",
  },
  {
    domain: "isweb.infoseek.co.jp",
    provider: "Infoseek isweb",
    category: "free-hosting",
    note: "2010 年終了。テキストサイト全盛期の主要ホスト",
  },
  {
    domain: "members.tripod.com",
    provider: "Tripod",
    category: "free-hosting",
  },
  {
    domain: "hp.infoseek.co.jp",
    provider: "Infoseek ホームページ",
    category: "free-hosting",
  },
  {
    domain: "www.fc2web.com",
    provider: "FC2WEB",
    category: "free-hosting",
  },
  {
    domain: "www.hoops.ne.jp",
    provider: "HOOPS!",
    category: "free-hosting",
  },
  {
    domain: "www.h7.dion.ne.jp",
    provider: "DION（KDDI）",
    category: "isp-space",
  },
  {
    domain: "www.freeweb.ne.jp",
    provider: "FreeWeb",
    category: "free-hosting",
  },
  {
    domain: "www.angelfire.com",
    provider: "Angelfire",
    category: "free-hosting",
  },
  {
    domain: "www.oocities.org",
    provider: "OoCities（GeoCities ミラー）",
    category: "free-hosting",
    note: "有志による GeoCities 復元ミラー。原本が消えていても残っている場合がある",
  },
  {
    domain: "geocities.restorativland.org",
    provider: "Restorativland（GeoCities アーカイブ）",
    category: "free-hosting",
    note: "Archive Team 系の GeoCities 復元プロジェクト",
  },

  // --- ISP のユーザースペース ---
  {
    domain: "www.nifty.com",
    provider: "@nifty / NIFTY-Serve",
    category: "isp-space",
    userPathHint: "/forum/ 系はパソコン通信由来",
  },
  {
    domain: "homepage1.nifty.com",
    provider: "@nifty ホームページ",
    category: "isp-space",
    note: "homepage1〜homepage3 まで存在",
  },
  {
    domain: "homepage2.nifty.com",
    provider: "@nifty ホームページ",
    category: "isp-space",
  },
  {
    domain: "homepage3.nifty.com",
    provider: "@nifty ホームページ",
    category: "isp-space",
  },
  {
    domain: "www2.biglobe.ne.jp",
    provider: "BIGLOBE",
    category: "isp-space",
    note: "www2〜www9 の連番ホストが存在する",
  },
  {
    domain: "www.so-net.ne.jp",
    provider: "So-net",
    category: "isp-space",
  },
  {
    domain: "www005.upp.so-net.ne.jp",
    provider: "So-net UPP",
    category: "isp-space",
  },
  {
    domain: "www.plala.or.jp",
    provider: "ぷらら",
    category: "isp-space",
  },
  {
    domain: "www.ocn.ne.jp",
    provider: "OCN（NTT）",
    category: "isp-space",
  },
  {
    domain: "www.hi-ho.ne.jp",
    provider: "hi-ho",
    category: "isp-space",
  },
  {
    domain: "www.asahi-net.or.jp",
    provider: "AsahiNet",
    category: "isp-space",
    userPathHint: "/~xxnnnnn/ 形式のチルダ URL",
    note: "現存率が比較的高い。チルダ URL は当時の典型",
  },
  {
    domain: "www.din.or.jp",
    provider: "DIN",
    category: "isp-space",
  },
  {
    domain: "www.iij4u.or.jp",
    provider: "IIJ4U",
    category: "isp-space",
  },
  {
    domain: "www.tky.3web.ne.jp",
    provider: "3WEB",
    category: "isp-space",
  },
  {
    domain: "www.sannet.ne.jp",
    provider: "SANNET",
    category: "isp-space",
  },
  {
    domain: "www.interq.or.jp",
    provider: "InterQ",
    category: "isp-space",
  },
  {
    domain: "www.bekkoame.ne.jp",
    provider: "ベッコアメ",
    category: "isp-space",
    note: "日本最初期の商用 ISP のひとつ。1995 年前後のサイトが眠る",
  },
  {
    domain: "www.airnet.ne.jp",
    provider: "AIRnet",
    category: "isp-space",
  },
  {
    domain: "village.infoweb.ne.jp",
    provider: "InfoWeb（富士通）",
    category: "isp-space",
    userPathHint: "/~username/",
    note: "実地調査で個人サイトのリンク先として頻出",
  },
  {
    domain: "www.sol.dti.ne.jp",
    provider: "DTI",
    category: "isp-space",
    userPathHint: "/~username/",
  },
  {
    domain: "www2s.biglobe.ne.jp",
    provider: "BIGLOBE（www2s 系）",
    category: "isp-space",
  },
  {
    domain: "www.ne.jp",
    provider: "各種 ISP 共用ドメイン",
    category: "isp-space",
    note: "ne.jp 配下は ISP のユーザー領域が集中する。domain マッチで広く探れる",
  },
  {
    domain: "www.mahoroba.ne.jp",
    provider: "まほろば",
    category: "isp-space",
  },

  // --- 大学・研究機関（最初期の個人ページ） ---
  {
    domain: "ac.jp",
    provider: "日本の大学全般",
    category: "university",
    userPathHint: "/~username/",
    note: "1993〜1996 年頃の日本語ページは大学のチルダ URL がほぼ唯一の存在",
  },

  // --- コミュニティ・ランキング・アンテナ（発見の入口） ---
  {
    domain: "www.readme.jp",
    provider: "ReadMe! JAPAN",
    category: "community",
    note: "テキストサイトのアクセスランキング。当時の人気サイト名鑑そのもの",
  },
  {
    domain: "www.tesio.net",
    provider: "日記才人（旧 日記猿人）",
    category: "community",
    note: "日記サイトの登録制ランキング。個人サイトの巨大な名簿",
  },
  {
    domain: "dir.yahoo.co.jp",
    provider: "Yahoo! JAPAN ディレクトリ",
    category: "community",
    note: "人力分類のカテゴリ。90 年代日本語サイトの最大の入口。2018 年終了",
  },
  {
    domain: "www.yahoo.co.jp",
    provider: "Yahoo! JAPAN（初期ディレクトリ）",
    category: "community",
    note: "1996〜2000 年頃のスナップショットはディレクトリ型で個人サイトが載っている",
  },
  {
    domain: "a.hatena.ne.jp",
    provider: "はてなアンテナ",
    category: "community",
    note: "更新チェック用アンテナ。登録先 URL の塊として使える",
  },
  {
    domain: "www.webring.ne.jp",
    provider: "WebRing Japan",
    category: "community",
    note: "Web リングのハブ。参加サイト一覧がそのままリンク集になる",
  },
  {
    domain: "cgi.www5.plala.or.jp",
    provider: "ぷらら CGI（掲示板・リング設置先）",
    category: "community",
  },
];

/** 現行検索エンジンに投げる site: クエリを組み立てる */
export function buildSiteQueries(
  keyword: string,
  categories?: LegacyHost["category"][],
  chunkSize = 8,
): string[] {
  const hosts = categories?.length
    ? LEGACY_HOSTS.filter((h) => categories.includes(h.category))
    : LEGACY_HOSTS;

  const queries: string[] = [];
  for (let i = 0; i < hosts.length; i += chunkSize) {
    const clause = hosts
      .slice(i, i + chunkSize)
      .map((h) => `site:${h.domain}`)
      .join(" OR ");
    queries.push(`(${clause}) ${keyword}`.trim());
  }
  return queries;
}

/**
 * 当時の日本語サイトに固有の言い回し。
 * 現代語のキーワードでは引っかからないため、検索語をこちらへ寄せると命中率が上がる。
 */
export const PERIOD_PHRASES: { phrase: string; note: string }[] = [
  { phrase: "リンクフリー", note: "ほぼ全ての個人サイトのトップに書かれていた" },
  { phrase: "キリ番", note: "アクセスカウンタの区切り番号。踏み逃げ禁止とセット" },
  { phrase: "相互リンク募集", note: "リンク集ページに頻出。芋づるの起点になる" },
  { phrase: "当サイトはリンクフリーです", note: "定型文そのものを完全一致で検索する" },
  { phrase: "ご自由にお持ち帰りください", note: "素材配布サイトの定型句" },
  { phrase: "画像は直リンク禁止", note: "素材・イラストサイト" },
  { phrase: "掲示板", note: "BBS 設置サイト。CGI 由来の URL が残る" },
  { phrase: "アクセスカウンター", note: "設置文言。90 年代ページの強い指標" },
  { phrase: "Netscape Navigator", note: "推奨ブラウザ表記。1995〜1999 年の強い指標" },
  { phrase: "IE4.0 以上推奨", note: "1998〜2001 年頃の指標" },
  { phrase: "800×600", note: "推奨解像度表記。90 年代後半の指標" },
  { phrase: "工事中", note: "Under Construction。未完成ページの定番" },
  { phrase: "はじめまして", note: "自己紹介ページの書き出し" },
  { phrase: "きりばん", note: "ひらがな表記の揺れも試す価値がある" },
  { phrase: "web拍手", note: "2002 年以降のテキストサイト・同人系" },
  { phrase: "足跡帳", note: "ゲストブック。訪問者の URL が残っている" },
];
