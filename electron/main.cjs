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
  const song = songs[0];
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
