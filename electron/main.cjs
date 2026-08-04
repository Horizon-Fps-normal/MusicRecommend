const { app, BrowserWindow, ipcMain, safeStorage, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const {
  enrichLastFmInfo,
  evaluateCandidateQuality,
  fetchAiCandidates,
  fetchLastFmCandidates,
  inferLanguage,
} = require('./recommendation-services.cjs');

const appDataPath = path.join(app.getPath('appData'), 'Daily Discovery');
const credentialsPath = path.join(appDataPath, 'credentials.secure.json');
app.setPath('userData', appDataPath);
app.setPath('sessionData', path.join(appDataPath, 'Session Data'));
app.setPath('cache', path.join(appDataPath, 'Cache'));
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');

function readCredentials() {
  try {
    const stored = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
    if (stored?.encrypted && safeStorage.isEncryptionAvailable()) {
      return JSON.parse(safeStorage.decryptString(Buffer.from(stored.encrypted, 'base64')));
    }
  } catch {
    // Missing or unreadable credentials are treated as an unconfigured app.
  }
  return {};
}

function credentialStatus(credentials = readCredentials()) {
  const isRealApiKey = (value) => Boolean(value && !/^https?:\/\//i.test(String(value).trim()));
  return {
    lastFmConfigured: isRealApiKey(credentials.lastFmApiKey),
    geminiConfigured: isRealApiKey(credentials.geminiApiKey),
    openAiConfigured: isRealApiKey(credentials.openAiApiKey),
    encryptionAvailable: safeStorage.isEncryptionAvailable(),
  };
}

ipcMain.handle('credentials:status', async () => credentialStatus());
ipcMain.handle('credentials:save', async (_event, updates = {}) => {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('当前 Windows 环境无法使用系统凭据加密');
  const current = readCredentials();
  for (const key of ['lastFmApiKey', 'geminiApiKey', 'openAiApiKey']) {
    if (typeof updates[key] !== 'string') continue;
    const value = updates[key].trim();
    if (value && /^https?:\/\//i.test(value)) throw new Error('API Key 字段必须填写真实密钥；接口地址请填写到 OpenAI Compatible API Base URL');
    if (value) current[key] = value;
    else if (updates.clear?.includes?.(key)) delete current[key];
  }
  fs.mkdirSync(appDataPath, { recursive: true });
  const encrypted = safeStorage.encryptString(JSON.stringify(current)).toString('base64');
  fs.writeFileSync(credentialsPath, JSON.stringify({ encrypted }), { encoding: 'utf8', mode: 0o600 });
  return credentialStatus(current);
});

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

function extractPlaylistId(input) {
  const value = String(input ?? '').trim().replace(/&amp;/gi, '&');
  const candidates = [value];
  try {
    const decoded = decodeURIComponent(value);
    if (decoded !== value) candidates.push(decoded);
  } catch {
    // Keep the original text when the copied URL contains an incomplete escape.
  }

  for (const candidate of candidates) {
    try {
      const url = new URL(candidate);
      for (const key of ['disstid', 'dissid', 'playlistid', 'playlist_id', 'playlist', 'songlist']) {
        const valueFromQuery = url.searchParams.get(key);
        if (valueFromQuery && /^\d{6,}$/.test(valueFromQuery)) return valueFromQuery;
      }
      const queryId = url.searchParams.get('id');
      const isPlaylistUrl = /playlist|taoge|songlist|share\/details/i.test(`${url.pathname}${url.search}`);
      if (isPlaylistUrl && queryId && /^\d{6,}$/.test(queryId)) return queryId;
    } catch {
      // Continue with pattern matching for partial or HTML-copied URLs.
    }

    const pathMatch = candidate.match(/(?:playlist|playlist_v2|songlist)[^0-9]{0,8}(\d{6,})/i);
    if (pathMatch?.[1]) return pathMatch[1];
    const keyMatch = candidate.match(/(?:disstid|dissid|playlist(?:id|_id)?|songlist|id)[^0-9]{0,16}(\d{6,})/i);
    if (keyMatch?.[1]) return keyMatch[1];
  }
  return null;
}

async function resolvePlaylistId(input) {
  const direct = extractPlaylistId(input);
  if (direct) return direct;
  const value = String(input ?? '').trim();
  if (!/^https?:\/\//i.test(value)) return null;

  let response;
  try {
    response = await fetch(value, {
      redirect: 'follow',
      headers: { Referer: 'https://y.qq.com/', 'User-Agent': 'Mozilla/5.0' },
    });
  } catch {
    throw new Error('无法访问 QQ 音乐分享链接，请检查网络或链接是否完整');
  }
  const body = await response.text();
  return extractPlaylistId(response.url) || extractPlaylistId(body);
}

ipcMain.handle('qqmusic:import-public-playlist', async (_event, input) => {
  const playlistId = await resolvePlaylistId(input);
  if (!playlistId) throw new Error('无法从链接中识别 QQ 音乐歌单 ID');

  const endpoint = `https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg?type=1&utf8=1&format=json&disstid=${playlistId}`;
  const response = await fetch(endpoint, { headers: { Referer: 'https://y.qq.com/', 'User-Agent': 'Mozilla/5.0' } });
  if (!response.ok) throw new Error(`QQ 音乐返回 HTTP ${response.status}`);
  const payload = await response.json();
  const data = payload?.cdlist?.[0] ?? payload?.data?.cdlist?.[0];
  if (!data) throw new Error('QQ 音乐没有返回可读取的歌单，可能是私密歌单或链接已失效');
  const tracks = (data?.songlist ?? []).map((song) => ({
    id: song.songmid ?? song.mid ?? song.songid,
    qqMid: song.songmid ?? song.mid ?? null,
    title: song.songname ?? song.name ?? '',
    artist: (song.singer ?? []).map((singer) => singer.name).join(' / '),
    album: song.albumname ?? song.album?.name ?? '',
    cover: song.albummid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${song.albummid}.jpg` : null,
    url: song.songmid ? `https://y.qq.com/n/ryqq/songDetail/${song.songmid}` : null,
  })).filter((track) => track.id && track.title);

  return {
    id: `qq-playlist-${playlistId}`,
    name: data?.dissname ?? `QQ 音乐歌单 ${playlistId}`,
    description: '通过 QQ 音乐公开链接导入',
    source: 'QQ 音乐 · 已同步',
    count: tracks.length,
    syncedAt: new Date().toLocaleString('zh-CN'),
    accent: '#8f7dca',
    url: input,
    tracks,
  };
});

function searchSongKey(title, artist) {
  return `${String(title ?? '').trim().toLowerCase()}::${String(artist ?? '').trim().toLowerCase()}`;
}

const POPULAR_COVER_COMMENT_COUNT = 10000;
const LOW_QUALITY_VERSION_PATTERN = /(?:\blive\b|live版|现场|实况|演唱会|巡回演出|音乐会|concert\s*(?:version|live|recording|tour)|\bdj\b|dj版|remix|rework|\bmix(?:ed)?\b|混音|混音版|sped\s*up|speed\s*up|加速|倍速|快版|\bslow(?:ed)?\b|slowed\s*\+?\s*reverb|慢速|降速|降调|升调|变调|氛围版|高燃|超燃|\b(?:0?\.\d+|1\.\d+)x\b|clean\s*(?:ver(?:sion)?\.?)?|片段|试听|preview|snippet|铃声|片头|片尾|伴奏|demo|节目|播客|有声书|朗诵|相声|脱口秀|访谈|讲解|解说|广播剧|抖音|短视频|网红|热梗|喊麦|土嗨|社会摇|口水歌|洗脑神曲|网络热歌|网络神曲)/i;

function normalizeIdentityText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/[\p{P}\p{S}\s]+/gu, '');
}

function baseSongTitle(value) {
  return normalizeIdentityText(String(value ?? '')
    .normalize('NFKC')
    .replace(/\([^)]*\)|（[^）]*）|\[[^\]]*\]|【[^】]*】/g, '')
    .replace(/\s*[-–—]\s*(?:live|remix|mix|version|ver\.?|edit|radio edit|acoustic|伴奏|混音|现场|加速|降速|降调).*$/i, ''));
}

function songArtistNames(song) {
  const singers = Array.isArray(song?.singer) ? song.singer.map((singer) => singer?.name) : [];
  return [...singers, song?.singername, song?.artist]
    .flatMap((value) => String(value ?? '').split(/\s*[/、,&]\s*/))
    .map(normalizeIdentityText)
    .filter(Boolean);
}

function artistMatches(song, expectedArtist) {
  const expected = normalizeIdentityText(expectedArtist);
  return Boolean(expected) && songArtistNames(song).includes(expected);
}

function artistSetsOverlap(first, second) {
  const firstNames = new Set(songArtistNames({ artist: first }));
  return songArtistNames({ artist: second }).some((artist) => firstNames.has(artist));
}

function isPreferredSearchSong(song) {
  const label = `${song?.songname ?? song?.title ?? ''} ${song?.albumname ?? song?.album ?? ''}`.normalize('NFKC').trim();
  if (LOW_QUALITY_VERSION_PATTERN.test(label)) return false;
  if (Number(song?.ver) === 3) return false;
  const interval = Number(song?.interval ?? song?.durationSeconds ?? 0);
  return !(Number.isFinite(interval) && interval > 0 && interval < 90);
}

function normalizeSearchSong(song, metadata = {}) {
  const qqMid = song.songmid ?? song.mid ?? null;
  const artist = song.singername ?? ((song.singer ?? []).map((singer) => singer.name).join(' / '));
  const albumMid = song.albummid ?? song.album?.mid ?? null;
  return {
    id: qqMid ?? metadata.id ?? null,
    qqMid,
    qqSongId: Number(song.songid ?? song.id ?? metadata.qqSongId) || null,
    title: song.songname ?? song.name ?? '',
    artist,
    album: song.albumname ?? song.album?.name ?? '',
    cover: albumMid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}.jpg` : (metadata.cover ?? null),
    url: qqMid ? `https://y.qq.com/n/ryqq/songDetail/${qqMid}` : (metadata.url ?? null),
    duration: song.interval ? `${Math.floor(song.interval / 60).toString().padStart(2, '0')}:${(song.interval % 60).toString().padStart(2, '0')}` : '',
    durationSeconds: Number(song.interval) || null,
    versionCode: Number(song.ver) || null,
    playbackUrl: null,
    genre: metadata.genre ?? '待识别曲风',
    mood: metadata.mood ?? '待识别氛围',
    energy: metadata.energy ?? null,
    popularity: metadata.popularity ?? null,
    similarity: Number.isFinite(Number(metadata.similarity)) ? Number(metadata.similarity) : 0.5,
    lastFmMatch: metadata.lastFmMatch ?? null,
    lastFmListeners: metadata.lastFmListeners ?? null,
    lastFmPlaycount: metadata.lastFmPlaycount ?? null,
    lastFmTags: metadata.lastFmTags ?? [],
    aiReason: metadata.aiReason ?? '',
    language: metadata.language ?? inferLanguage(song.songname ?? song.name, artist),
    chartVerified: metadata.chartVerified === true,
    isShortVideoViral: metadata.isShortVideoViral === true,
    discoverySource: metadata.discoverySource ?? 'qq-search',
    sourceGroup: metadata.sourceGroup ?? 'discovery',
    tag: metadata.tag ?? '歌单外探索',
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function mapSettledWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      try {
        results[index] = { status: 'fulfilled', value: await mapper(items[index], index) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
      await delay(120);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

async function searchQQSongs(query, limit = 20, page = 1) {
  const safePage = Math.max(1, Math.min(20, Number(page) || 1));
  const endpoint = `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?format=json&p=${safePage}&n=${limit}&w=${encodeURIComponent(query)}`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(endpoint, { headers: { Referer: 'https://y.qq.com/', 'User-Agent': 'Mozilla/5.0' } });
    if (!response.ok) throw new Error(`QQ 音乐搜索返回 HTTP ${response.status}`);
    const payload = await response.json();
    const songs = payload?.data?.song?.list ?? payload?.song?.list ?? [];
    if (songs.length > 0 || attempt === 1) return songs;
    await delay(450);
  }
  return [];
}

async function fetchQQCommentCount(track) {
  if (!track?.qqSongId) return { ...track, commentCount: null, commentCountVerified: false };
  const endpoint = `https://c.y.qq.com/base/fcgi-bin/fcg_global_comment_h5.fcg?biztype=1&topid=${track.qqSongId}&cmd=8&pagenum=0&pagesize=1`;
  const response = await fetch(endpoint, { headers: { Referer: 'https://y.qq.com/', 'User-Agent': 'Mozilla/5.0' } });
  if (!response.ok) throw new Error(`QQ 音乐评论返回 HTTP ${response.status}`);
  const payload = await response.json();
  const commentCount = Number(payload?.comment?.commenttotal);
  if (!Number.isFinite(commentCount)) return { ...track, commentCount: null, commentCountVerified: false };
  const popularity = Math.min(100, Math.round(35 + Math.log10(commentCount + 1) * 14));
  return { ...track, commentCount, commentCountVerified: true, popularity: Math.max(Number(track.popularity) || 0, popularity) };
}

const QQ_CHARTS = [
  { id: 4, genre: '华语流行', mood: '热门', energy: 62, tag: '流行指数' },
  { id: 26, genre: '流行', mood: '热门', energy: 65, tag: '热歌榜' },
  { id: 27, genre: '流行', mood: '新鲜', energy: 64, tag: '新歌榜' },
  { id: 57, genre: '电子', mood: '高能', energy: 82, tag: '电音榜' },
  { id: 58, genre: '说唱', mood: '高能', energy: 78, tag: '说唱榜' },
  { id: 62, genre: '流行', mood: '上升', energy: 70, tag: '飙升榜' },
  { id: 3, genre: '欧美流行', mood: '明亮', energy: 66, tag: '欧美榜' },
  { id: 16, genre: '韩流流行', mood: '明亮', energy: 72, tag: '韩国榜' },
];

function parseQQJsonp(text) {
  const start = text.indexOf('(');
  const end = text.lastIndexOf(')');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start + 1, end));
  } catch {
    return null;
  }
}

async function fetchQQChartPreviews() {
  const endpoint = `https://c.y.qq.com/v8/fcg-bin/fcg_myqq_toplist.fcg?uin=0&needNewCode=1&platform=h5&g_tk=5381`;
  const response = await fetch(endpoint, { headers: { Referer: 'https://y.qq.com/', 'User-Agent': 'Mozilla/5.0' } });
  if (!response.ok) throw new Error(`QQ 榜单返回 HTTP ${response.status}`);
  const payload = parseQQJsonp(await response.text());
  const toplists = payload?.data?.topList ?? [];
  return QQ_CHARTS.flatMap((chart) => {
    const item = toplists.find((entry) => Number(entry.id) === chart.id);
    return (item?.songList ?? []).slice(0, 2).map((song) => ({ ...song, chart, chartCover: item?.picUrl ?? null }));
  });
}

async function searchChartSong(song) {
  const query = `${song.songname ?? ''} ${song.singername ?? ''}`.trim();
  if (!query) return [];
  const songs = await searchQQSongs(query, 5);
  const metadata = {
    genre: song.chart.genre,
    mood: song.chart.mood,
    energy: song.chart.energy,
    popularity: song.chart.id === 26 || song.chart.id === 62 ? 90 : 82,
    similarity: 0.52,
    chartVerified: true,
    discoverySource: 'qq-chart',
    sourceGroup: 'chart',
    tag: `QQ ${song.chart.tag}`,
  };
  const targetTitle = baseSongTitle(song.songname);
  const targetArtists = songArtistNames({ artist: song.singername });
  const matched = songs.find((candidate) => isPreferredSearchSong(candidate)
    && baseSongTitle(candidate.songname) === targetTitle
    && (targetArtists.length === 0 || targetArtists.some((artist) => songArtistNames(candidate).includes(artist))));
  if (matched) return [normalizeSearchSong(matched, metadata)];
  if (!isPreferredSearchSong(song)) return [];
  return [normalizeSearchSong(song, {
    ...metadata,
    id: `chart-${song.chart.id}-${song.songname}-${song.singername}`,
    cover: song.chartCover,
    url: `https://y.qq.com/n/ryqq/search?w=${encodeURIComponent(query)}`,
  })];
}

async function discoverChartSongs() {
  let previews = [];
  try {
    previews = await fetchQQChartPreviews();
  } catch {
    return [];
  }
  return (await mapSettledWithConcurrency(previews, 2, searchChartSong))
    .filter((result) => result.status === 'fulfilled')
    .flatMap((result) => result.value);
}

function trackIdentityKey(track) {
  return `${baseSongTitle(track?.title ?? track?.songname)}::${normalizeIdentityText(String(track?.artist ?? track?.singername ?? '').split(/\s*[/、,&]\s*/)[0])}`;
}

async function resolveServiceCandidate(candidate) {
  const query = `${candidate.title ?? ''} ${candidate.artist ?? ''}`.trim();
  if (!query) return null;
  const songs = await searchQQSongs(query, 8);
  const expectedTitle = baseSongTitle(candidate.title);
  const expectedArtist = String(candidate.artist ?? '').split(/\s*[/、,&]\s*/)[0];
  const matched = songs.find((song) => isPreferredSearchSong(song)
    && baseSongTitle(song.songname) === expectedTitle
    && artistMatches(song, expectedArtist));
  return matched ? normalizeSearchSong(matched, candidate) : null;
}

function mergeServiceCandidates(...collections) {
  const merged = new Map();
  collections.flat().forEach((candidate) => {
    if (!candidate?.title || !candidate?.artist) return;
    const key = trackIdentityKey(candidate);
    const current = merged.get(key);
    if (!current) {
      merged.set(key, candidate);
      return;
    }
    merged.set(key, {
      ...current,
      ...candidate,
      similarity: Math.max(Number(current.similarity) || 0, Number(candidate.similarity) || 0),
      lastFmMatch: Math.max(Number(current.lastFmMatch) || 0, Number(candidate.lastFmMatch) || 0) || null,
      aiReason: current.aiReason || candidate.aiReason || '',
      discoverySource: `${current.discoverySource}+${candidate.discoverySource}`,
    });
  });
  return [...merged.values()];
}

function matchesLanguage(track, language) {
  if (!language || language === 'auto' || language === 'mixed') return true;
  if (language === 'ja-ko') return track.language === 'ja' || track.language === 'ko';
  return track.language === language;
}

ipcMain.handle('qqmusic:discover-tracks', async (_event, {
  seeds = [],
  likedSeeds = [],
  dislikedSeeds = [],
  playlistTracks = [],
  excludedTracks = [],
  pageStart = 1,
  limit = 240,
  requestedAmount = 10,
  settings = {},
  includeAi = true,
  mood = 'auto',
  language = 'auto',
} = {}) => {
  const excludedMids = new Set(excludedTracks.map((track) => String(track.qqMid ?? track.id ?? '')).filter(Boolean));
  const excludedKeys = new Set(excludedTracks.map((track) => searchSongKey(track.title, track.artist)));
  const blockedTitles = new Map();
  playlistTracks.forEach((track) => {
    const title = baseSongTitle(track.title);
    if (!title) return;
    if (!blockedTitles.has(title)) blockedTitles.set(title, []);
    blockedTitles.get(title).push(track.artist);
  });

  const credentials = readCredentials();
  if (!credentials.lastFmApiKey) return [];
  const positiveSeeds = likedSeeds.length ? [...likedSeeds, ...seeds.filter((track) => !dislikedSeeds.some((item) => item.id === track.id))] : seeds;
  const aiSeedOffset = positiveSeeds.length ? (Math.max(0, Number(pageStart) - 1) * 8) % positiveSeeds.length : 0;
  const aiSeeds = [...positiveSeeds.slice(aiSeedOffset), ...positiveSeeds.slice(0, aiSeedOffset)];
  const candidateLimit = Math.min(100, Math.max(50, (Number(requestedAmount) || 10) * 8));
  const [lastFmResult, aiResult, chartResult] = await Promise.allSettled([
    fetchLastFmCandidates({ seeds: positiveSeeds, apiKey: credentials.lastFmApiKey, offset: Math.max(0, Number(pageStart) - 1) * 8, limit: candidateLimit }),
    includeAi ? fetchAiCandidates({
      provider: settings.aiProvider || 'off',
      credentials,
      settings,
      seeds: aiSeeds,
      liked: likedSeeds,
      disliked: dislikedSeeds,
      mood,
      language,
    }) : Promise.resolve([]),
    discoverChartSongs(),
  ]);
  const lastFmCandidates = lastFmResult.status === 'fulfilled' ? lastFmResult.value : [];
  const aiCandidates = aiResult.status === 'fulfilled' ? aiResult.value : [];
  const chartSongs = chartResult.status === 'fulfilled' ? chartResult.value : [];
  const serviceCandidates = mergeServiceCandidates(lastFmCandidates, aiCandidates).slice(0, candidateLimit);
  if (serviceCandidates.length === 0) return [];
  const enrichedCandidates = await enrichLastFmInfo(serviceCandidates, credentials.lastFmApiKey, { limit: candidateLimit });
  const resolved = await mapSettledWithConcurrency(enrichedCandidates, 4, resolveServiceCandidate);
  const chartByTitle = new Map();
  chartSongs.forEach((track) => {
    const title = baseSongTitle(track.title);
    if (!chartByTitle.has(title)) chartByTitle.set(title, []);
    chartByTitle.get(title).push(track);
  });
  const sourceSongs = resolved
    .filter((result) => result.status === 'fulfilled' && result.value)
    .map((result) => {
      const track = result.value;
      const chartMatches = chartByTitle.get(baseSongTitle(track.title)) ?? [];
      const chartVerified = chartMatches.some((chartTrack) => artistSetsOverlap(chartTrack.artist, track.artist));
      return { ...track, chartVerified, tag: chartVerified ? 'QQ 榜单验证' : track.tag };
    });

  const seenIds = new Set();
  const seenTitles = new Set();
  const provisional = [];
  const poolLimit = Math.min(Math.max(1, Number(limit) || 500), candidateLimit);
  for (const track of sourceSongs) {
    const key = searchSongKey(track.title, track.artist);
    const titleKey = baseSongTitle(track.title);
    if (!track.id || !track.title || !titleKey || !matchesLanguage(track, language) || !isPreferredSearchSong(track) || seenIds.has(track.id) || seenTitles.has(titleKey) || excludedMids.has(String(track.id)) || excludedKeys.has(key)) continue;
    seenIds.add(track.id);
    seenTitles.add(titleKey);
    provisional.push(track);
    if (provisional.length >= poolLimit) break;
  }

  const checked = await mapSettledWithConcurrency(provisional, 4, fetchQQCommentCount);
  const discovered = [];
  for (let index = 0; index < checked.length; index += 1) {
    const track = checked[index].status === 'fulfilled'
      ? checked[index].value
      : { ...provisional[index], commentCount: null, commentCountVerified: false };
    const quality = evaluateCandidateQuality(track);
    if (!quality.accepted) continue;
    const blockedArtists = blockedTitles.get(baseSongTitle(track.title));
    if (blockedArtists?.length) {
      if (blockedArtists.some((artist) => artistSetsOverlap(artist, track.artist))) continue;
      if (!track.commentCountVerified || track.commentCount < POPULAR_COVER_COMMENT_COUNT) continue;
      track.tag = '高热度翻唱';
    }
    discovered.push({ ...track, qualityTier: quality.tier, qualitySignals: quality.signals, minCommentRequirement: quality.minComments });
    if (discovered.length >= Math.max(20, Math.min(1000, Number(limit) || 240))) break;
  }
  return discovered;
});

ipcMain.handle('qqmusic:play-track', async (_event, { audioUrl, webUrl }) => {
  if (audioUrl) {
    const parsedAudioUrl = new URL(audioUrl);
    if (!['http:', 'https:'].includes(parsedAudioUrl.protocol)) {
      throw new Error('应用内播放只接受安全的 HTTP(S) 音频地址');
    }
    return { opened: true, mode: 'in-app-audio', audioUrl: parsedAudioUrl.toString() };
  }

  if (webUrl) {
    const parsedWebUrl = new URL(webUrl);
    if (!['http:', 'https:'].includes(parsedWebUrl.protocol)) throw new Error('QQ 音乐网页地址无效');
    await shell.openExternal(parsedWebUrl.toString());
    return { opened: true, mode: 'web-fallback', webUrl: parsedWebUrl.toString() };
  }

  return { opened: false, mode: 'playback-unavailable' };
});

ipcMain.handle('qqmusic:resolve-track', async (_event, { title, artist }) => {
  const query = `${title ?? ''} ${artist ?? ''}`.trim();
  if (!query) return null;
  const endpoint = `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?format=json&p=1&n=5&w=${encodeURIComponent(query)}`;
  const response = await fetch(endpoint, { headers: { Referer: 'https://y.qq.com/' } });
  if (!response.ok) throw new Error(`QQ 音乐搜索返回 HTTP ${response.status}`);
  const payload = await response.json();
  const songs = payload?.data?.song?.list ?? payload?.song?.list ?? [];
  const expectedTitle = baseSongTitle(title);
  const song = songs.find((candidate) => isPreferredSearchSong(candidate)
    && (!expectedTitle || baseSongTitle(candidate.songname) === expectedTitle)
    && (!artist || artistMatches(candidate, String(artist).split(/\s*[/、,&]\s*/)[0])))
    ?? songs.find(isPreferredSearchSong);
  if (!song) return null;
  const qqMid = song.songmid ?? song.mid ?? null;
  const albumMid = song.albummid ?? song.album?.mid ?? null;
  return {
    qqMid,
    cover: albumMid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}.jpg` : null,
    url: qqMid ? `https://y.qq.com/n/ryqq/songDetail/${qqMid}` : null,
    album: song.albumname ?? song.album?.name ?? '',
    duration: song.interval ? `${Math.floor(song.interval / 60).toString().padStart(2, '0')}:${(song.interval % 60).toString().padStart(2, '0')}` : '',
    playbackUrl: null,
    title: song.songname ?? song.name ?? title,
    artist: song.singername ?? ((song.singer ?? []).map((singer) => singer.name).join(' / ') || artist),
  };
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1120,
    minHeight: 760,
    icon: path.join(__dirname, '..', 'assets', 'daily-discovery-icon.ico'),
    backgroundColor: '#111827',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

if (hasSingleInstanceLock) {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });

  app.whenReady().then(() => {
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
