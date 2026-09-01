/**
 * 90 年代〜2000 年代前半の個人サイトが置かれていたホスティング領域の辞書。
 *
 * 当時の個人サイトはほぼ全て「プロバイダのおまけスペース」か「無料ホームページサービス」に
 * 置かれていた。現行検索エンジンでも、この既知ドメインで site: 絞り込みをすると
 * 素のキーワード検索より格段に当たる。CDX の探索起点としても使う。
 *
 * 日本語圏と海外（英語圏・欧州）の双方を収める。両者は構造が違うので `region` で分ける:
 * 日本のジオシティーズが `/<エリア>/<番地>/` なのに対し、本家 GeoCities は
 * `/<Neighborhood>/<Suburb>/<番地>/` の 3 階層があり、Angelfire は `/<コード>/<ユーザー>/`。
 */

/**
 * ホストが属する地域。`jp` 以外はまとめて「海外」として扱える。
 * 国別に分けてあるのは、探し物の言語と当時のプロバイダが強く対応するため
 * （フランスの個人サイトは chez.com / multimania、ドイツは t-online に集中する）。
 */
export type HostRegion =
  | "jp"
  | "us"
  | "uk"
  | "fr"
  | "de"
  | "it"
  | "nl"
  | "au"
  /** 国を跨いで使われたサービス（WebRing、DMOZ、Tripod など） */
  | "global";

/** ツールから渡される絞り込み指定。`intl` は「日本以外すべて」 */
export type RegionFilter = HostRegion | "intl" | "all";

export interface LegacyHost {
  /** ホスト名（CDX / site: にそのまま使える） */
  domain: string;
  /** 提供元の呼称 */
  provider: string;
  category: "free-hosting" | "isp-space" | "university" | "community";
  region: HostRegion;
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

/**
 * 海外向けクエリで混入する現行の商業ドメイン。
 *
 * 事情は日本と同じで、`site:geocities.com` や `site:angelfire.com` は索引から消えているため
 * 検索エンジンが絞り込みを緩める。実測では通販・まとめ系（Pinterest, eBay, Etsy）へ流れる。
 * Tripod / Angelfire は旅行系・不動産系の現行語彙と綴りが近く、TripAdvisor が特に混ざる。
 */
export const COMMERCIAL_NOISE_DOMAINS_INTL = [
  "amazon.com",
  "ebay.com",
  "etsy.com",
  "pinterest.com",
  "aliexpress.com",
  "walmart.com",
  "tripadvisor.com",
  "facebook.com",
];

/** 除外句に使う商業ドメインを地域で選ぶ */
export function noiseDomainsFor(region: RegionFilter = "jp"): string[] {
  if (region === "jp") return COMMERCIAL_NOISE_DOMAINS;
  if (region === "all") {
    return [...COMMERCIAL_NOISE_DOMAINS, ...COMMERCIAL_NOISE_DOMAINS_INTL];
  }
  return COMMERCIAL_NOISE_DOMAINS_INTL;
}

/** 全クエリ末尾に付ける除外句 */
export function noiseExclusionClause(region: RegionFilter = "jp"): string {
  return noiseDomainsFor(region)
    .map((d) => `-site:${d}`)
    .join(" ");
}

/** 地域フィルタにホストが合致するか。`intl` は日本以外すべて */
export function matchesRegion(host: LegacyHost, filter: RegionFilter): boolean {
  if (filter === "all") return true;
  if (filter === "intl") return host.region !== "jp";
  return host.region === filter;
}

/**
 * 日本語圏のホスト。region は全件 `jp` なので、末尾の合成時にまとめて付ける
 * （1 件ずつ書くと 40 行以上の同じ記述が並び、追加時に写し忘れる）。
 */
const JP_HOSTS: Omit<LegacyHost, "region">[] = [
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
 * 海外（英語圏・欧州・豪州）のホスト。
 *
 * 母数の中心は米国の無料ホスティング 4 強（GeoCities / Angelfire / Tripod / Xoom）と
 * AOL のユーザー領域。欧州は ISP のおまけスペースの比重が日本より更に高く、
 * 国ごとに寡占（英 Demon・Freeserve、独 T-Online、仏 Wanadoo・Multimania）していた。
 */
const INTL_HOSTS: LegacyHost[] = [
  // --- 米国系 無料ホームページサービス（海外の個人サイトの最大母数） ---
  {
    domain: "www.geocities.com",
    provider: "GeoCities（Yahoo!）",
    category: "free-hosting",
    region: "us",
    searchIndex: "retro",
    userPathHint: "/<Neighborhood>/<番地>/ または /<Neighborhood>/<Suburb>/<番地>/",
    note:
      "2009/10 サービス終了。世界最大の個人サイトの墓場。エリアは Area51（SF・ゲーム）、" +
      "SoHo（アート）、Athens（学術）、Hollywood（映画）、Heartland（家庭）、" +
      "SiliconValley（技術）、Tokyo（アジア文化）など。Area51/Vault のような 2 段細分がある点が日本版との最大の違い。" +
      "www5.geocities.com など連番ホストにも同じ空間が入っている",
  },
  {
    domain: "www.angelfire.com",
    provider: "Angelfire（Lycos）",
    category: "free-hosting",
    region: "us",
    searchIndex: "retro",
    userPathHint: "/<2〜6文字のコード>/<ユーザー名>/ 例: /on/username/",
    note:
      "先頭 1 階層がユーザーの場合（/49racing/）と、地域・ジャンルのコードを挟む場合（/on/username/）が混在する。" +
      "discover_sites はこれを実データから判定して畳む",
  },
  {
    domain: "members.tripod.com",
    provider: "Tripod（Lycos）",
    category: "free-hosting",
    region: "us",
    searchIndex: "retro",
    userPathHint: "/<ユーザー名>/ 稀に /~<ユーザー名>/",
  },
  {
    domain: "members.xoom.com",
    provider: "Xoom（後の NBCi）",
    category: "free-hosting",
    region: "us",
    searchIndex: "retro",
    note: "1999 年に NBC へ売却、2001 年に閉鎖。閉鎖が早いぶん 90 年代のページ比率が高い",
  },
  {
    domain: "www.fortunecity.com",
    provider: "FortuneCity",
    category: "free-hosting",
    region: "us",
    searchIndex: "retro",
    userPathHint: "/<エリア>/<地区>/<番地>/ GeoCities に似た都市メタファ",
    note: "2012 年に無料ホスティングを終了",
  },
  {
    domain: "members.aol.com",
    provider: "AOL Personal Web Pages",
    category: "free-hosting",
    region: "us",
    searchIndex: "retro",
    userPathHint: "/<スクリーンネーム>/",
    note: "2008 年終了。AOL 全盛期の個人ページ。スクリーンネームに空白が入る URL がある（%20 で始まる）",
  },
  {
    domain: "hometown.aol.com",
    provider: "AOL Hometown",
    category: "free-hosting",
    region: "us",
    searchIndex: "retro",
    note: "members.aol.com の後継。2008 年に予告 1 か月で全削除された",
  },
  {
    domain: "www.50megs.com",
    provider: "50megs",
    category: "free-hosting",
    region: "us",
    searchIndex: "retro",
  },
  {
    domain: "www.crosswinds.net",
    provider: "Crosswinds",
    category: "free-hosting",
    region: "us",
    searchIndex: "retro",
  },
  {
    domain: "www.virtualave.net",
    provider: "Virtual Avenue",
    category: "free-hosting",
    region: "us",
    searchIndex: "retro",
  },
  {
    domain: "www.freeyellow.com",
    provider: "FreeYellow",
    category: "free-hosting",
    region: "us",
    searchIndex: "retro",
  },
  {
    domain: "www.talkcity.com",
    provider: "Talk City",
    category: "free-hosting",
    region: "us",
    searchIndex: "retro",
    note: "チャットコミュニティ由来のホームページ領域",
  },
  {
    domain: "www.theglobe.com",
    provider: "theglobe.com",
    category: "free-hosting",
    region: "us",
    searchIndex: "retro",
    note: "ドットコムバブルの象徴。コミュニティ＋個人ページ",
  },
  {
    domain: "www.tripod.com",
    provider: "Tripod（現行）",
    category: "free-hosting",
    region: "us",
    searchIndex: "modern",
    note: "Lycos 傘下で現行のサービスページが動いている。site: は現代のページを返すので CDX 専用",
  },
  {
    domain: "www.freeservers.com",
    provider: "Freeservers",
    category: "free-hosting",
    region: "us",
    searchIndex: "modern",
    note: "現在も有料ホスティングとして稼働",
  },
  {
    domain: "www.homestead.com",
    provider: "Homestead",
    category: "free-hosting",
    region: "us",
    searchIndex: "modern",
    note: "現在はビジネス向けサイトビルダー。当時のユーザーページは CDX 側から",
  },

  // --- GeoCities 復元ミラー（現行検索にも索引されている数少ない retro ホスト） ---
  {
    domain: "www.oocities.org",
    provider: "OoCities（GeoCities ミラー）",
    category: "free-hosting",
    region: "global",
    searchIndex: "retro",
    note:
      "有志による GeoCities 復元ミラー。日本版・本家の双方を含む。原本が消えていても残っている場合がある。" +
      "現行検索に索引されているため site: が実際に効く数少ない retro ホスト",
  },
  {
    domain: "geocities.restorativland.org",
    provider: "Restorativland（GeoCities アーカイブ）",
    category: "free-hosting",
    region: "global",
    searchIndex: "retro",
    note: "Archive Team 系の GeoCities 復元プロジェクト",
  },
  {
    domain: "www.geocities.ws",
    provider: "GeoCities.ws（復元ミラー兼ホスティング）",
    category: "free-hosting",
    region: "global",
    searchIndex: "retro",
    note: "旧 GeoCities のコピーを配信している第三者サービス。原本の代替として読める場合がある",
  },

  // --- 英国 ---
  {
    domain: "homepages.demon.co.uk",
    provider: "Demon Internet",
    category: "isp-space",
    region: "uk",
    searchIndex: "retro",
    note: "英国最初期の商用 ISP。1994〜1996 年の英語個人ページが眠る",
  },
  {
    domain: "www.users.globalnet.co.uk",
    provider: "GlobalNet",
    category: "isp-space",
    region: "uk",
    searchIndex: "retro",
  },
  {
    domain: "freespace.virgin.net",
    provider: "Virgin Net",
    category: "isp-space",
    region: "uk",
    searchIndex: "retro",
  },
  {
    domain: "website.lineone.net",
    provider: "LineOne",
    category: "isp-space",
    region: "uk",
    searchIndex: "retro",
  },
  {
    domain: "dspace.dial.pipex.com",
    provider: "Pipex Dial",
    category: "isp-space",
    region: "uk",
    searchIndex: "retro",
  },
  {
    domain: "www.btinternet.com",
    provider: "BT Internet",
    category: "isp-space",
    region: "uk",
    searchIndex: "modern",
    userPathHint: "/~username/",
    note: "事業サイトが現役。ユーザー領域はチルダ配下",
  },
  {
    domain: "homepage.ntlworld.com",
    provider: "NTL World",
    category: "isp-space",
    region: "uk",
    searchIndex: "retro",
  },
  {
    domain: "ac.uk",
    provider: "英国の大学全般",
    category: "university",
    region: "uk",
    searchIndex: "modern",
    userPathHint: "/~username/",
    note: "1993〜1996 年の英語個人ページは大学のチルダ URL が中心。site: は現代のページを返すので CDX 専用",
  },

  // --- 欧州大陸 ---
  {
    domain: "www.multimania.com",
    provider: "Multimania（仏）",
    category: "free-hosting",
    region: "fr",
    searchIndex: "retro",
    note: "フランス語圏最大の無料ホームページサービス。後に Lycos France へ統合",
  },
  {
    domain: "www.chez.com",
    provider: "Chez.com（仏）",
    category: "free-hosting",
    region: "fr",
    searchIndex: "retro",
  },
  {
    domain: "perso.wanadoo.fr",
    provider: "Wanadoo（France Télécom）",
    category: "isp-space",
    region: "fr",
    searchIndex: "retro",
    note: "フランスの ISP 個人スペースの本命",
  },
  {
    domain: "www.ifrance.com",
    provider: "iFrance",
    category: "free-hosting",
    region: "fr",
    searchIndex: "retro",
  },
  {
    domain: "membres.lycos.fr",
    provider: "Lycos France",
    category: "free-hosting",
    region: "fr",
    searchIndex: "retro",
  },
  {
    domain: "home.t-online.de",
    provider: "T-Online（独）",
    category: "isp-space",
    region: "de",
    searchIndex: "modern",
    note: "ドイツの個人サイトの最大母数。事業サイトが現役なので site: ではなく CDX から",
  },
  {
    domain: "www.beepworld.de",
    provider: "Beepworld（独）",
    category: "free-hosting",
    region: "de",
    searchIndex: "modern",
  },
  {
    domain: "members.aol.de",
    provider: "AOL Deutschland",
    category: "free-hosting",
    region: "de",
    searchIndex: "retro",
  },
  {
    domain: "digilander.iol.it",
    provider: "Digilander（伊）",
    category: "free-hosting",
    region: "it",
    searchIndex: "retro",
    note: "イタリア語圏の無料ホームページサービス",
  },
  {
    domain: "space.tin.it",
    provider: "TIN（Telecom Italia）",
    category: "isp-space",
    region: "it",
    searchIndex: "retro",
  },
  {
    domain: "www.xs4all.nl",
    provider: "XS4ALL（蘭）",
    category: "isp-space",
    region: "nl",
    searchIndex: "modern",
    userPathHint: "/~username/",
    note: "オランダ最初期の ISP。チルダ配下に古いページが残る",
  },
  {
    domain: "home.planet.nl",
    provider: "Planet Internet（蘭）",
    category: "isp-space",
    region: "nl",
    searchIndex: "retro",
  },

  // --- 豪州 ---
  {
    domain: "www.ozemail.com.au",
    provider: "OzEmail（豪）",
    category: "isp-space",
    region: "au",
    searchIndex: "retro",
    userPathHint: "/~username/",
  },
  {
    domain: "users.bigpond.net.au",
    provider: "Telstra BigPond（豪）",
    category: "isp-space",
    region: "au",
    searchIndex: "retro",
  },

  // --- 米国 ISP ---
  {
    domain: "home.earthlink.net",
    provider: "EarthLink",
    category: "isp-space",
    region: "us",
    searchIndex: "retro",
    userPathHint: "/~username/",
  },
  {
    domain: "ourworld.compuserve.com",
    provider: "CompuServe OurWorld",
    category: "isp-space",
    region: "us",
    searchIndex: "retro",
    userPathHint: "/homepages/<username>/",
    note: "パソコン通信由来。90 年代前半のユーザーが多い",
  },
  {
    domain: "pages.prodigy.net",
    provider: "Prodigy",
    category: "isp-space",
    region: "us",
    searchIndex: "retro",
  },
  {
    domain: "www.erols.com",
    provider: "Erol's Internet",
    category: "isp-space",
    region: "us",
    searchIndex: "retro",
    userPathHint: "/~username/",
  },
  {
    domain: "www.mindspring.com",
    provider: "MindSpring",
    category: "isp-space",
    region: "us",
    searchIndex: "retro",
    userPathHint: "/~username/",
  },
  {
    domain: "edu",
    provider: "米国の大学全般",
    category: "university",
    region: "us",
    searchIndex: "modern",
    userPathHint: "/~username/",
    note: "1991〜1995 年の個人ページはほぼ大学のチルダ URL。CDX の起点として使う",
  },

  // --- 海外の発見の入口（ディレクトリ・リング） ---
  {
    domain: "dmoz.org",
    provider: "Open Directory Project（DMOZ）",
    category: "community",
    region: "global",
    searchIndex: "retro",
    note:
      "人力分類の世界最大ディレクトリ。2017 年終了。海外版の dir.yahoo.co.jp に相当する最大の名簿。" +
      "アーカイブ上のカテゴリページを crawl_link_neighborhood の起点にするのが海外探索の主力",
  },
  {
    domain: "dir.yahoo.com",
    provider: "Yahoo! Directory（本家）",
    category: "community",
    region: "us",
    searchIndex: "retro",
    note: "2014 年終了。1995〜2000 年のスナップショットは当時の個人サイト名鑑",
  },
  {
    domain: "www.webring.org",
    provider: "WebRing（本家）",
    category: "community",
    region: "global",
    searchIndex: "modern",
    note:
      "Web リングのハブ。リングの参加サイト一覧がそのままリンク集になる。" +
      "現行サイトが動いているので、当時の一覧は CDX から取る（dir.webring.com / www.webring.com も同義）",
  },
  {
    domain: "www.ringsurf.com",
    provider: "RingSurf",
    category: "community",
    region: "global",
    searchIndex: "modern",
    note: "WebRing の競合。参加サイト一覧の構造は同じ",
  },
  {
    domain: "www.bomis.com",
    provider: "Bomis（リング型ディレクトリ）",
    category: "community",
    region: "us",
    searchIndex: "retro",
    note: "Wikipedia 創業者らが運営していたリング集。趣味系の個人サイトを大量に束ねていた",
  },
  {
    domain: "curlie.org",
    provider: "Curlie（DMOZ 後継）",
    category: "community",
    region: "global",
    searchIndex: "modern",
    note: "DMOZ のデータを引き継いだ現行ディレクトリ。当時の URL がそのまま残っている項目がある",
  },
  {
    domain: "neocities.org",
    provider: "Neocities",
    category: "community",
    region: "global",
    searchIndex: "modern",
    note: "現行の GeoCities 復刻コミュニティ。当時のサイトではないが、retro web の資料・リンク集が集まる",
  },
];

/** 日本語圏と海外を合わせた全ホスト辞書 */
export const LEGACY_HOSTS: LegacyHost[] = [
  ...JP_HOSTS.map((h) => ({ ...h, region: "jp" as const })),
  ...INTL_HOSTS,
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
  /** 対象地域。既定 'jp'。'intl' で海外全域、'all' で両方 */
  region?: RegionFilter;
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
  const { includeModernHosts = false, chunkSize = 8, region = "jp" } = options;

  const hosts = LEGACY_HOSTS.filter(
    (h) =>
      matchesRegion(h, region) &&
      (!categories?.length || categories.includes(h.category)) &&
      (includeModernHosts || h.searchIndex === "retro"),
  );

  const exclusion = noiseExclusionClause(region);
  const queries: string[] = [];
  for (let i = 0; i < hosts.length; i += chunkSize) {
    const clause = hosts.slice(i, i + chunkSize).map(siteToken).join(" OR ");
    queries.push(`(${clause}) ${keyword} ${exclusion}`.replace(/\s+/g, " ").trim());
  }
  return queries;
}

export interface PhraseQueryOptions {
  /** 生成本数（既定 8） */
  count?: number;
  /** 言い回しの言語。既定 'ja'。'both' で日英を混ぜる */
  lang?: PhraseLang | "both";
  /** 除外句に使う商業ドメインの地域。既定は lang に合わせる */
  region?: RegionFilter;
}

/** 当時の言い回しで叩くクエリ。site: を使わないぶん商業ノイズを除外句だけで抑える。 */
export function buildPhraseQueries(
  keyword: string,
  options: PhraseQueryOptions = {},
): string[] {
  const { count = 8, lang = "ja" } = options;
  const region = options.region ?? (lang === "ja" ? "jp" : lang === "en" ? "intl" : "all");
  const exclusion = noiseExclusionClause(region);
  return periodPhrases(lang)
    .slice(0, count)
    .map((p) => `"${p.phrase}" ${keyword} ${exclusion}`.replace(/\s+/g, " ").trim());
}

export type PhraseLang = "ja" | "en";

/** 言語で言い回しを絞る。'both' は既定件数内に両言語が入るよう日英を交互にする。 */
export function periodPhrases(lang: PhraseLang | "both" = "ja"): PeriodPhrase[] {
  if (lang !== "both") return PERIOD_PHRASES.filter((p) => p.lang === lang);

  const ja = PERIOD_PHRASES.filter((p) => p.lang === "ja");
  const en = PERIOD_PHRASES.filter((p) => p.lang === "en");
  const mixed: PeriodPhrase[] = [];
  for (let i = 0; i < Math.max(ja.length, en.length); i++) {
    if (ja[i]) mixed.push(ja[i]);
    if (en[i]) mixed.push(en[i]);
  }
  return mixed;
}

/** 地域に対応する言い回しの言語。日本以外は英語で当たる */
export function phraseLangFor(region: RegionFilter): PhraseLang | "both" {
  if (region === "jp") return "ja";
  if (region === "all") return "both";
  return "en";
}

export interface PeriodPhrase {
  phrase: string;
  note: string;
  lang: PhraseLang;
}

/**
 * 当時のサイトに固有の言い回し。
 *
 * 現代語のキーワードでは引っかからないため、検索語をこちらへ寄せると命中率が上がる。
 * 英語圏には日本語と対応する定型文があり（リンクフリー → "This page is link free"、
 * キリ番 → "You are visitor number"）、語彙を訳しただけでは当たらないので個別に持つ。
 */
export const PERIOD_PHRASES: PeriodPhrase[] = [
  // --- 英語圏 ---
  {
    phrase: "Under Construction",
    note: "工事中。90 年代ページ最強の指標。GIF の工事標識とセット",
    lang: "en",
  },
  {
    phrase: "Sign my guestbook",
    note: "ゲストブック。訪問者の当時の URL が丸ごと残っていることがある",
    lang: "en",
  },
  {
    phrase: "You are visitor number",
    note: "アクセスカウンタ。キリ番に相当する",
    lang: "en",
  },
  {
    phrase: "Best viewed with Netscape",
    note: "推奨ブラウザ表記。1995〜1999 年の強い指標",
    lang: "en",
  },
  {
    phrase: "best viewed at 800x600",
    note: "推奨解像度。90 年代後半",
    lang: "en",
  },
  {
    phrase: "This page is link free",
    note: "リンクフリー相当。海外では稀だが日本人の英語ページに出る",
    lang: "en",
  },
  {
    phrase: "webring",
    note: "Web リング参加バナー。参加サイト一覧へ辿れる最重要の入口",
    lang: "en",
  },
  {
    phrase: "My Home Page",
    note: "自己紹介ページの定番タイトル",
    lang: "en",
  },
  {
    phrase: "Cool Links",
    note: "リンク集ページの定番名。芋づるの起点",
    lang: "en",
  },
  {
    phrase: "Made with Notepad",
    note: "手打ち HTML の矜持を示すバナー",
    lang: "en",
  },
  {
    phrase: "Last updated",
    note: "更新日表記。年を添えると年代で絞れる",
    lang: "en",
  },
  {
    phrase: "Nedstat counter",
    note: "欧州で普及したアクセスカウンタ。英国・独・蘭のページに多い",
    lang: "en",
  },
  {
    phrase: "click here to enter",
    note: "スプラッシュページ。入口ページの定型",
    lang: "en",
  },
  {
    phrase: "Netscape Now",
    note: "Netscape 推奨バナーの文言",
    lang: "en",
  },

  // --- 日本語圏 ---
  { phrase: "リンクフリー", note: "ほぼ全ての個人サイトのトップに書かれていた", lang: "ja" },
  { phrase: "キリ番", note: "アクセスカウンタの区切り番号。踏み逃げ禁止とセット", lang: "ja" },
  { phrase: "相互リンク募集", note: "リンク集ページに頻出。芋づるの起点になる", lang: "ja" },
  { phrase: "工事中", note: "Under Construction。未完成ページの定番", lang: "ja" },
  { phrase: "当サイトはリンクフリーです", note: "定型文そのものを完全一致で検索する", lang: "ja" },
  { phrase: "ご自由にお持ち帰りください", note: "素材配布サイトの定型句", lang: "ja" },
  { phrase: "画像は直リンク禁止", note: "素材・イラストサイト", lang: "ja" },
  { phrase: "掲示板", note: "BBS 設置サイト。CGI 由来の URL が残る", lang: "ja" },
  { phrase: "アクセスカウンター", note: "設置文言。90 年代ページの強い指標", lang: "ja" },
  { phrase: "Netscape Navigator", note: "推奨ブラウザ表記。1995〜1999 年の強い指標", lang: "ja" },
  { phrase: "IE4.0 以上推奨", note: "1998〜2001 年頃の指標", lang: "ja" },
  { phrase: "800×600", note: "推奨解像度表記。90 年代後半の指標", lang: "ja" },
  { phrase: "はじめまして", note: "自己紹介ページの書き出し", lang: "ja" },
  { phrase: "きりばん", note: "ひらがな表記の揺れも試す価値がある", lang: "ja" },
  { phrase: "web拍手", note: "2002 年以降のテキストサイト・同人系", lang: "ja" },
  { phrase: "足跡帳", note: "ゲストブック。訪問者の URL が残っている", lang: "ja" },
];
