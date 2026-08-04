/**
 * QQ Music integration boundary.
 *
 * The public endpoints used by community clients are not an official stable
 * SDK. Keeping this boundary separate lets the recommendation engine and UI
 * remain usable when a QQ Music endpoint or session flow changes.
 */
export function extractPlaylistId(input) {
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

export function createQQMusicAdapter({ fetchImpl = fetch } = {}) {
  return {
    async importPublicPlaylist(input) {
      const playlistId = extractPlaylistId(input);
      if (!playlistId) throw new Error('无法从链接中识别 QQ 音乐歌单 ID');

      // This endpoint shape is documented by community clients such as
      // MergeMusicDesktop. It must be validated against a live response before
      // being enabled in the desktop main process.
      const endpoint = `https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg?type=1&utf8=1&format=json&disstid=${playlistId}`;
      const response = await fetchImpl(endpoint, { headers: { Referer: 'https://y.qq.com/' } });
      if (!response.ok) throw new Error(`QQ 音乐返回 HTTP ${response.status}`);
      const payload = await response.json();
      return normalizePlaylist(payload, playlistId);
    },
  };
}

function normalizePlaylist(payload, playlistId) {
  const data = payload?.cdlist?.[0] ?? payload?.data?.cdlist?.[0];
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
    source: 'QQ 音乐 · 待验证',
    count: tracks.length,
    syncedAt: new Date().toLocaleString('zh-CN'),
    tracks,
  };
}
