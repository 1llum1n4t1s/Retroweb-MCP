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
  /**
   * 現行の検索エンジンで `site:` 絞り込みをしたとき、当時の内容が返るか。
   *
   *   "retro"  … サービス終了済み、またはアーカイブミラー。当時の内容が返りうる
   *   "modern" … 同じドメインで現在も事業サイトが動いており、`site:` は現代のページを返す
   *
   * "modern" を既定のクエリに混ぜると、探しているのが 90 年代の個人サイトなのに
   * ISP の料金ページやショッピングモールばかりが返る。既定では除外する。
   */
  searchIndex: "retro" | "modern";
  /** 個人サイトが置かれた典型的なパス形（CDX の prefix 検索に使う） */
  userPathHint?: string;
  note?: string;
}

/**
 * `site:` 絞り込みに混入する現行の商業ドメイン。全クエリへ `-site:` で付ける。
 *
 * 検索エンジンは site: 指定でヒットが乏しいと絞り込みを緩めて近いドメインを返す。
 * 実測では `site:geocities.co.jp 都市伝説` が Yahoo!ショッピング（shopping.geocities.jp）
 * だけを返した。ジオシティーズ本体が索引から消えた結果、生きている同名系ドメインへ
 * 流れ込むのが原因なので、ドメイン指定を直すだけでは閉じない。
 */
export const COMMERCIAL_NOISE_DOMAINS = [
  "shopping.geocities.jp",
  "shopping.yahoo.co.jp",
  "store.shopping.yahoo.co.jp",
  "auctions.yahoo.co.jp",
  "paypaymall.yahoo.co.jp",
  "amazon.co.jp",
  "rakuten.co.jp",
  "mercari.com",
];

/** 全クエリ末尾に付ける除外句 */
export function noiseExclusionClause(): string {
  return COMMERCIAL_NOISE_DOMAINS.map((d) => `-site:${d}`).join(" ");
}

export const LEGACY_HOSTS: LegacyHost[] = [
  // --- 無料ホームページサービス（個人サイトの最大母数） ---
  {
    domain: "www.geocities.co.jp",
    provider: "ジオシティーズ（Yahoo! JAPAN）",
    category: "free-hosting",
    searchIndex: "retro",
    userPathHint: "/<エリア名>/<番地>/ 例: /Playtown/1234/",
    note: "2019/03 サービス終了。日本語個人サイト最大の墓場。エリア名は Playtown / Hollywood / SiliconValley / Milano / Berkeley など。site: は www 付きで指定する（裸の geocities.co.jp だと Yahoo!ショッピングへ流れる）",
  },
  {
    domain: "www.geocities.jp",
    provider: "ジオシティーズ（後期ドメイン）",
    category: "free-hosting",
    searchIndex: "retro",
    userPathHint: "/<ユーザーID>/",
    note: "2000 年代以降のアカウントはこちら。shopping.geocities.jp は現行の Yahoo!ショッピングなので混同しない",
  },
  {
    domain: "tripod.co.jp",
    provider: "Tripod Japan",
    category: "free-hosting",
    searchIndex: "modern",
    note: "当時のホスティングは消滅し、現在は同名の映像制作会社がこのドメインを使っている（実測で site: が同社サイトを返した）。CDX の起点としてのみ有効",
  },
  {
    domain: "isweb.infoseek.co.jp",
    provider: "Infoseek isweb",
    category: "free-hosting",
    searchIndex: "retro",
    note: "2010 年終了。テキストサイト全盛期の主要ホスト",
  },
  {
    domain: "members.tripod.com",
    provider: "Tripod",
    category: "free-hosting",
    searchIndex: "retro",
  },
  {
    domain: "hp.infoseek.co.jp",
    provider: "Infoseek ホームページ",
    category: "free-hosting",
    searchIndex: "retro",
  },
  {
    domain: "www.fc2web.com",
    provider: "FC2WEB",
    category: "free-hosting",
    searchIndex: "retro",
  },
  {
    domain: "www.hoops.ne.jp",
    provider: "HOOPS!",
    category: "free-hosting",
    searchIndex: "retro",
  },
  {
    domain: "www.h7.dion.ne.jp",
    provider: "DION（KDDI）",
    category: "isp-space",
    searchIndex: "retro",
  },
  {
    domain: "www.freeweb.ne.jp",
    provider: "FreeWeb",
    category: "free-hosting",
    searchIndex: "retro",
  },
  {
    domain: "www.angelfire.com",
    provider: "Angelfire",
    category: "free-hosting",
    searchIndex: "retro",
  },
  {
    domain: "www.oocities.org",
    provider: "OoCities（GeoCities ミラー）",
    category: "free-hosting",
    searchIndex: "retro",
    note: "有志による GeoCities 復元ミラー。原本が消えていても残っている場合がある。現行検索に索引されている数少ない retro ホストで、site: が実際に効く",
  },
  {
    domain: "geocities.restorativland.org",
    provider: "Restorativland（GeoCities アーカイブ）",
    category: "free-hosting",
    searchIndex: "retro",
    note: "Archive Team 系の GeoCities 復元プロジェクト",
  },

  // --- ISP のユーザースペース ---
  {
    domain: "www.nifty.com",
    provider: "@nifty / NIFTY-Serve",
    category: "isp-space",
    searchIndex: "modern",
    userPathHint: "/forum/ 系はパソコン通信由来",
    note: "現在も @nifty の事業サイトが稼働。site: は現代のページを返すので既定のクエリからは外す",
  },
  {
    domain: "homepage1.nifty.com",
    provider: "@nifty ホームページ",
    category: "isp-space",
    searchIndex: "retro",
    note: "homepage1〜homepage3 まで存在。2016 年にサービス終了",
  },
  {
    domain: "homepage2.nifty.com",
    provider: "@nifty ホームページ",
    category: "isp-space",
    searchIndex: "retro",
  },
  {
    domain: "homepage3.nifty.com",
    provider: "@nifty ホームページ",
    category: "isp-space",
    searchIndex: "retro",
  },
  {
    domain: "www2.biglobe.ne.jp",
    provider: "BIGLOBE",
    category: "isp-space",
    searchIndex: "retro",
    note: "www2〜www9 の連番ホストが存在する。事業サイトは www.biglobe.ne.jp 側",
  },
  {
    domain: "www.so-net.ne.jp",
    provider: "So-net",
    category: "isp-space",
    searchIndex: "modern",
    note: "現在も So-net の事業サイトが稼働",
  },
  {
    domain: "www005.upp.so-net.ne.jp",
    provider: "So-net UPP",
    category: "isp-space",
    searchIndex: "retro",
  },
  {
    domain: "www.plala.or.jp",
    provider: "ぷらら",
    category: "isp-space",
    searchIndex: "modern",
    note: "現在も ISP の事業サイトが稼働",
  },
  {
    domain: "www.ocn.ne.jp",
    provider: "OCN（NTT）",
    category: "isp-space",
    searchIndex: "modern",
    note: "現在も ISP の事業サイトが稼働",
  },
  {
    domain: "www.hi-ho.ne.jp",
    provider: "hi-ho",
    category: "isp-space",
    searchIndex: "modern",
    note: "現在も ISP の事業サイトが稼働",
  },
  {
    domain: "www.asahi-net.or.jp",
    provider: "AsahiNet",
    category: "isp-space",
    searchIndex: "modern",
    userPathHint: "/~xxnnnnn/ 形式のチルダ URL",
    note: "事業サイトが稼働中だが、/~ 配下のユーザーページは現存率が高い。site: するならパスまで絞る",
  },
  {
    domain: "www.din.or.jp",
    provider: "DIN",
    category: "isp-space",
    searchIndex: "modern",
  },
  {
    domain: "www.iij4u.or.jp",
    provider: "IIJ4U",
    category: "isp-space",
    searchIndex: "modern",
  },
  {
    domain: "www.tky.3web.ne.jp",
    provider: "3WEB",
    category: "isp-space",
    searchIndex: "retro",
  },
  {
    domain: "www.sannet.ne.jp",
    provider: "SANNET",
    category: "isp-space",
    searchIndex: "retro",
  },
  {
    domain: "www.interq.or.jp",
    provider: "InterQ",
    category: "isp-space",
    searchIndex: "retro",
  },
  {
    domain: "www.bekkoame.ne.jp",
    provider: "ベッコアメ",
    category: "isp-space",
    searchIndex: "retro",
    note: "日本最初期の商用 ISP のひとつ。1995 年前後のサイトが眠る",
  },
  {
    domain: "www.airnet.ne.jp",
    provider: "AIRnet",
    category: "isp-space",
    searchIndex: "retro",
  },
  {
    domain: "village.infoweb.ne.jp",
    provider: "InfoWeb（富士通）",
    category: "isp-space",
    searchIndex: "retro",
    userPathHint: "/~username/",
    note: "実地調査で個人サイトのリンク先として頻出",
  },
  {
    domain: "www.sol.dti.ne.jp",
    provider: "DTI",
    category: "isp-space",
    searchIndex: "modern",
    userPathHint: "/~username/",
  },
  {
    domain: "www2s.biglobe.ne.jp",
    provider: "BIGLOBE（www2s 系）",
    category: "isp-space",
    searchIndex: "retro",
  },
  {
    domain: "www.ne.jp",
    provider: "各種 ISP 共用ドメイン",
    category: "isp-space",
    searchIndex: "modern",
    note: "ne.jp 配下は ISP のユーザー領域が集中する。CDX の domain マッチでは有効だが、site: では現代の ISP サイトばかり返る",
  },
  {
    domain: "www.mahoroba.ne.jp",
    provider: "まほろば",
    category: "isp-space",
    searchIndex: "retro",
  },

  // --- 大学・研究機関（最初期の個人ページ） ---
  {
    domain: "ac.jp",
    provider: "日本の大学全般",
    category: "university",
    searchIndex: "modern",
    userPathHint: "/~username/",
    note: "1993〜1996 年頃の日本語ページは大学のチルダ URL がほぼ唯一の存在。ただし ac.jp は現役の大学サイトそのものなので、site: では現代のページしか返らない。CDX 側の起点として使う",
  },

  // --- コミュニティ・ランキング・アンテナ（発見の入口） ---
  {
    domain: "www.readme.jp",
    provider: "ReadMe! JAPAN",
    category: "community",
    searchIndex: "retro",
    note: "テキストサイトのアクセスランキング。当時の人気サイト名鑑そのもの",
  },
  {
    domain: "www.tesio.net",
    provider: "日記才人（旧 日記猿人）",
    category: "community",
    searchIndex: "retro",
    note: "日記サイトの登録制ランキング。個人サイトの巨大な名簿",
  },
  {
    domain: "dir.yahoo.co.jp",
    provider: "Yahoo! JAPAN ディレクトリ",
    category: "community",
    searchIndex: "retro",
    note: "人力分類のカテゴリ。90 年代日本語サイトの最大の入口。2018 年終了",
  },
  {
    domain: "www.yahoo.co.jp",
    provider: "Yahoo! JAPAN（初期ディレクトリ）",
    category: "community",
    searchIndex: "modern",
    note: "1996〜2000 年頃のスナップショットはディレクトリ型で個人サイトが載っている。現行の site: ではポータルとショッピングしか返らないので CDX 専用",
  },
  {
    domain: "a.hatena.ne.jp",
    provider: "はてなアンテナ",
    category: "community",
    searchIndex: "retro",
    note: "更新チェック用アンテナ。登録先 URL の塊として使える",
  },
  {
    domain: "www.webring.ne.jp",
    provider: "WebRing Japan",
    category: "community",
    searchIndex: "retro",
    note: "Web リングのハブ。参加サイト一覧がそのままリンク集になる",
  },
  {
    domain: "cgi.www5.plala.or.jp",
    provider: "ぷらら CGI（掲示板・リング設置先）",
    category: "community",
    searchIndex: "retro",
  },
];

/**
 * `site:` 用のホスト指定を作る。
 *
 * 事業サイトが現役のドメインは、ユーザー領域のパスまで絞らないと現代のページしか返らない。
 * チルダ形式のヒントがあるものはそこまで含める。
 */
function siteToken(host: LegacyHost): string {
  if (host.searchIndex === "modern" && host.userPathHint?.includes("~")) {
    return `site:${host.domain}/~`;
  }
  return `site:${host.domain}`;
}

export interface SiteQueryOptions {
  /**
   * 事業サイトが現役のドメイン（searchIndex="modern"）も含める。
   * 既定 false。含めるとヒットの大半が現代のページになる。
   */
  includeModernHosts?: boolean;
  /** 1 クエリあたりの OR 句の数（既定 8） */
  chunkSize?: number;
}

/**
 * 現行検索エンジンに投げる site: クエリを組み立てる。
 *
 * 既定では searchIndex="retro" のホストだけを使い、末尾に商業ドメインの除外句を付ける。
 * これを付けないと、索引から消えたホストを site: 指定した際に検索エンジンが絞り込みを
 * 緩め、生きているショッピングサイトばかりが返る（実測）。
 */
export function buildSiteQueries(
  keyword: string,
  categories?: LegacyHost["category"][],
  options: SiteQueryOptions = {},
): string[] {
  const { includeModernHosts = false, chunkSize = 8 } = options;

  const hosts = LEGACY_HOSTS.filter(
    (h) =>
      (!categories?.length || categories.includes(h.category)) &&
      (includeModernHosts || h.searchIndex === "retro"),
  );

  const exclusion = noiseExclusionClause();
  const queries: string[] = [];
  for (let i = 0; i < hosts.length; i += chunkSize) {
    const clause = hosts.slice(i, i + chunkSize).map(siteToken).join(" OR ");
    queries.push(`(${clause}) ${keyword} ${exclusion}`.replace(/\s+/g, " ").trim());
  }
  return queries;
}

/** 当時の言い回しで叩くクエリ。site: を使わないぶん商業ノイズを除外句だけで抑える。 */
export function buildPhraseQueries(keyword: string, count = 8): string[] {
  const exclusion = noiseExclusionClause();
  return PERIOD_PHRASES.slice(0, count).map((p) =>
    `"${p.phrase}" ${keyword} ${exclusion}`.replace(/\s+/g, " ").trim(),
  );
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
