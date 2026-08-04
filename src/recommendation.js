const DEFAULT_POPULARITY = 72;
const MIN_POPULARITY = 45;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function hash(value) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function colorForTrack(track) {
  const palette = ['#cf8a63', '#8b6fb5', '#6d8fb3', '#73a77e', '#d16d70', '#c49b63', '#556aa4', '#6a8b85'];
  return track.color || palette[hash(`${track.title ?? ''}:${track.artist ?? ''}`) % palette.length];
}

function normalizeTrack(track, fromPlaylist) {
  const title = String(track?.title ?? track?.songname ?? track?.name ?? '').trim();
  const artist = String(track?.artist ?? track?.singername ?? '').trim();
  const id = String(track?.id ?? track?.qqMid ?? `${title}::${artist}`).trim();
  const popularity = Number.isFinite(Number(track?.popularity)) ? clamp(Number(track.popularity), 0, 100) : DEFAULT_POPULARITY;
  const energy = Number.isFinite(Number(track?.energy)) ? clamp(Number(track.energy), 0, 100) : 55;

  return {
    ...track,
    id,
    title: title || '未命名歌曲',
    artist: artist || '未知歌手',
    album: String(track?.album ?? '').trim() || '未知专辑',
    color: colorForTrack(track ?? {}),
    popularity,
    energy,
    genre: track?.genre || (fromPlaylist ? '来自 QQ 歌单' : '待识别曲风'),
    mood: track?.mood || '待识别情绪',
    tag: track?.tag || (fromPlaylist ? '来自你的歌单' : '探索发现'),
  };
}

function dayKey() {
  return new Date().toISOString().slice(0, 10);
}

function stableDailyScore(track) {
  const dailyVariation = (hash(`${dayKey()}:${track.id}`) % 1000) / 1000;
  const energyFit = 100 - Math.abs(track.energy - 55);
  return track.popularity * 0.48 + energyFit * 0.22 + dailyVariation * 30;
}

export function hasRealPlaylistTracks(playlist) {
  return Array.isArray(playlist?.tracks) && playlist.tracks.length > 0;
}

export function buildRecommendations({ playlist, fallbackCandidates, amount, excluded = new Set(), rejected = new Set() }) {
  const fromPlaylist = hasRealPlaylistTracks(playlist);
  const source = fromPlaylist ? playlist.tracks : fallbackCandidates;
  const normalized = source
    .map((track) => normalizeTrack(track, fromPlaylist))
    .filter((track) => track.title && !excluded.has(track.id) && !rejected.has(track.id));

  const eligible = normalized.filter((track) => track.popularity >= MIN_POPULARITY);
  const pool = (eligible.length >= amount ? eligible : normalized).sort((a, b) => stableDailyScore(b) - stableDailyScore(a));
  const picked = [];
  const artists = new Set();

  // First pass enforces the user's daily one-song-per-artist rule.
  for (const track of pool) {
    if (artists.has(track.artist)) continue;
    picked.push(track);
    artists.add(track.artist);
    if (picked.length >= amount) return picked;
  }

  // If the source has too few distinct artists, relax only this constraint so
  // the requested quantity can still be reached without repeating a song.
  for (const track of pool) {
    if (picked.some((item) => item.id === track.id)) continue;
    picked.push(track);
    if (picked.length >= amount) break;
  }

  return picked;
}
