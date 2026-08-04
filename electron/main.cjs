const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('node:path');

const appDataPath = path.join(app.getPath('appData'), 'Daily Discovery');
app.setPath('userData', appDataPath);
app.setPath('sessionData', path.join(appDataPath, 'Session Data'));
app.setPath('cache', path.join(appDataPath, 'Cache'));
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');

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

function artistSignature(value) {
  return String(value ?? '').trim().toLowerCase().split(/\s*[/、,&]\s*/)[0];
}

const LOW_QUALITY_VERSION_PATTERN = /(?:\blive\b|live版|现场版?|演唱会|\bdj\b|dj版|remix|rework|sped\s*up|speed\s*up|加速|倍速|快版|\bslow(?:ed)?\b|slowed\s*\+?\s*reverb|慢速|降速|片段|试听|preview|snippet|铃声|片头|片尾|伴奏|demo)/i;

function isPreferredSearchSong(song) {
  const label = `${song?.songname ?? song?.title ?? ''} ${song?.albumname ?? song?.album ?? ''}`.trim();
  if (LOW_QUALITY_VERSION_PATTERN.test(label)) return false;
  const interval = Number(song?.interval ?? song?.durationSeconds ?? 0);
  return !(Number.isFinite(interval) && interval > 0 && interval < 90);
}

function normalizeSearchSong(song, metadata = {}) {
  const qqMid = song.songmid ?? song.mid ?? null;
  const artist = song.singername ?? ((song.singer ?? []).map((singer) => singer.name).join(' / '));
  const albumMid = song.albummid ?? song.album?.mid ?? null;
  return {
    id: qqMid,
    qqMid,
    title: song.songname ?? song.name ?? '',
    artist,
    album: song.albumname ?? song.album?.name ?? '',
    cover: albumMid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}.jpg` : null,
    url: qqMid ? `https://y.qq.com/n/ryqq/songDetail/${qqMid}` : null,
    duration: song.interval ? `${Math.floor(song.interval / 60).toString().padStart(2, '0')}:${(song.interval % 60).toString().padStart(2, '0')}` : '',
    durationSeconds: Number(song.interval) || null,
    playbackUrl: null,
    genre: metadata.genre ?? '待识别曲风',
    mood: metadata.mood ?? '待识别氛围',
    energy: metadata.energy ?? null,
    popularity: metadata.popularity ?? null,
    discoverySource: metadata.discoverySource ?? 'qq-search',
    sourceGroup: metadata.sourceGroup ?? 'discovery',
    tag: metadata.tag ?? '歌单外探索',
  };
}

async function searchQQSongs(query, limit = 20, page = 1) {
  const safePage = Math.max(1, Math.min(20, Number(page) || 1));
  const endpoint = `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?format=json&p=${safePage}&n=${limit}&w=${encodeURIComponent(query)}`;
  const response = await fetch(endpoint, { headers: { Referer: 'https://y.qq.com/', 'User-Agent': 'Mozilla/5.0' } });
  if (!response.ok) throw new Error(`QQ 音乐搜索返回 HTTP ${response.status}`);
  const payload = await response.json();
  return payload?.data?.song?.list ?? payload?.song?.list ?? [];
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

async function fetchQQChartPreview(chart) {
  const endpoint = `https://c.y.qq.com/v8/fcg-bin/fcg_myqq_toplist.fcg?uin=0&needNewCode=1&platform=h5&g_tk=5381`;
  const response = await fetch(endpoint, { headers: { Referer: 'https://y.qq.com/', 'User-Agent': 'Mozilla/5.0' } });
  if (!response.ok) throw new Error(`QQ 榜单返回 HTTP ${response.status}`);
  const payload = parseQQJsonp(await response.text());
  const item = (payload?.data?.topList ?? []).find((entry) => Number(entry.id) === chart.id);
  return (item?.songList ?? []).map((song) => ({ ...song, chart }));
}

async function searchChartSong(song) {
  const query = `${song.songname ?? ''} ${song.singername ?? ''}`.trim();
  if (!query) return [];
  const songs = await searchQQSongs(query, 5);
  return songs.filter(isPreferredSearchSong).map((candidate) => normalizeSearchSong(candidate, {
    genre: song.chart.genre,
    mood: song.chart.mood,
    energy: song.chart.energy,
    popularity: song.chart.id === 26 || song.chart.id === 62 ? 90 : 82,
    discoverySource: 'qq-chart',
    sourceGroup: 'chart',
    tag: `QQ ${song.chart.tag}`,
  }));
}

async function discoverChartSongs() {
  const previews = (await Promise.allSettled(QQ_CHARTS.map(fetchQQChartPreview)))
    .filter((result) => result.status === 'fulfilled')
    .flatMap((result) => result.value);
  return (await Promise.allSettled(previews.map(searchChartSong)))
    .filter((result) => result.status === 'fulfilled')
    .flatMap((result) => result.value);
}

ipcMain.handle('qqmusic:discover-tracks', async (_event, { seeds = [], excludedTracks = [], profile = null, pageStart = 1, limit = 240 } = {}) => {
  const excludedMids = new Set(excludedTracks.map((track) => String(track.qqMid ?? track.id ?? '')).filter(Boolean));
  const excludedKeys = new Set(excludedTracks.map((track) => searchSongKey(track.title, track.artist)));
  const artists = [...new Set(seeds
    .flatMap((track) => String(track.artist ?? '').split(/\s*[/、,&]\s*/))
    .map((artist) => artist.trim())
    .filter(Boolean))].slice(0, 24);
  const searchPages = [0, 1, 2].map((offset) => ((Number(pageStart) - 1 + offset) % 6) + 1);
  const artistQueries = artists.flatMap((artist) => searchPages.map((page) => ({ artist, page })));
  const artistResponses = await Promise.allSettled(artistQueries.map(({ artist, page }) => searchQQSongs(artist, 50, page)));
  const artistSongs = artistResponses
    .filter((response) => response.status === 'fulfilled')
    .flatMap((response, index) => response.value.filter(isPreferredSearchSong).map((song) => normalizeSearchSong(song, {
      discoverySource: 'artist-neighbor',
      sourceGroup: 'playlist-artist',
      tag: '相近歌手探索',
      popularity: 78,
      searchPage: artistQueries[index]?.page ?? 1,
    })));
  const chartSongs = await discoverChartSongs();
  const sourceSongs = [];
  const sourceLength = Math.max(artistSongs.length, chartSongs.length);
  for (let index = 0; index < sourceLength; index += 1) {
    if (chartSongs[index]) sourceSongs.push(chartSongs[index]);
    if (artistSongs[index]) sourceSongs.push(artistSongs[index]);
  }
  if (sourceSongs.length === 0 && !profile) return [];
  const seen = new Set();
  const discovered = [];
  for (const track of sourceSongs) {
    const key = searchSongKey(track.title, track.artist);
    if (!track.id || !track.title || !isPreferredSearchSong(track) || seen.has(track.id) || excludedMids.has(String(track.id)) || excludedKeys.has(key)) continue;
    seen.add(track.id);
    discovered.push(track);
    if (discovered.length >= Math.max(1, Math.min(800, Number(limit) || 240))) break;
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
  const song = songs.find(isPreferredSearchSong);
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
