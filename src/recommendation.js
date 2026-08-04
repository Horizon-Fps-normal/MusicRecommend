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

function labelText(value) {
  return String(value ?? '').trim().toLowerCase();
}

function genreFamily(value) {
  const text = labelText(value);
  if (/r&b|soul|爵士|灵魂/.test(text)) return 'rnb-soul';
  if (/electro|电子|舞曲|dj|techno|house/.test(text)) return 'electronic';
  if (/rap|说唱|嘻哈|hip.?hop/.test(text)) return 'hip-hop';
  if (/rock|摇滚|朋克|metal/.test(text)) return 'rock';
  if (/folk|民谣|乡村|独立民谣/.test(text)) return 'folk';
  if (/k-pop|韩流|韩国/.test(text)) return 'k-pop';
  if (/j-pop|日本|日系/.test(text)) return 'j-pop';
  if (/classical|古典|纯音乐|soundtrack|原声/.test(text)) return 'classical-score';
  if (/pop|流行|华语|欧美|复古|独立/.test(text)) return 'pop';
  return text || 'unknown';
}

function moodFamily(value) {
  const text = labelText(value);
  if (/high|energy|热门|热烈|高能|激昂|兴奋/.test(text)) return 'high-energy';
  if (/calm|quiet|沉静|平静|治愈|温柔|松弛|放松/.test(text)) return 'calm';
  if (/bright|明亮|开阔|轻快|开心|清新/.test(text)) return 'bright';
  if (/romantic|浪漫|甜|心动/.test(text)) return 'romantic';
  if (/sad|忧郁|伤感|孤独|夜晚|情绪/.test(text)) return 'melancholy';
  if (/dark|暗|神秘|迷幻/.test(text)) return 'dark';
  if (/new|新鲜|上升/.test(text)) return 'fresh';
  return text || 'unknown';
}

function estimateEnergy(track) {
  if (Number.isFinite(Number(track?.energy))) return clamp(Number(track.energy), 0, 100);
  const genre = genreFamily(track?.genre);
  const mood = moodFamily(track?.mood);
  if (genre === 'electronic' || genre === 'hip-hop' || mood === 'high-energy') return 78;
  if (mood === 'calm' || mood === 'melancholy') return 42;
  return 58;
}

function estimatePopularity(track) {
  return Number.isFinite(Number(track?.popularity)) ? clamp(Number(track.popularity), 0, 100) : DEFAULT_POPULARITY;
}

function inferredGenre(track) {
  const text = labelText(`${track?.title ?? ''} ${track?.artist ?? ''} ${track?.album ?? ''}`);
  if (/remix|dj|club|dance|电音/.test(text)) return '电子';
  if (/rap|说唱|嘻哈|hip.?hop/.test(text)) return '说唱';
  if (/rock|摇滚|朋克|metal/.test(text)) return '摇滚';
  if (/acoustic|民谣|folk|乡村/.test(text)) return '民谣';
  if (/ost|soundtrack|原声|影视/.test(text)) return '影视原声';
  return '流行';
}

function inferredMood(track) {
  const text = labelText(`${track?.title ?? ''} ${track?.album ?? ''}`);
  if (/remix|dj|dance|club|party|energy|热歌|live/.test(text)) return '高能';
  if (/night|夜|blue|sad|雨|离开|孤独|梦/.test(text)) return '沉静';
  if (/love|爱|summer|sun|sunshine|happy|开心/.test(text)) return '明亮';
  return '日常';
}

function normalizeTrack(track, fromPlaylist) {
  const title = String(track?.title ?? track?.songname ?? track?.name ?? '').trim();
  const artist = String(track?.artist ?? track?.singername ?? '').trim();
  const id = String(track?.id ?? track?.qqMid ?? `${title}::${artist}`).trim();
  const popularity = estimatePopularity(track);
  const energy = estimateEnergy(track);
  const genre = track?.genre || inferredGenre(track);
  const mood = track?.mood || inferredMood(track);

  return {
    ...track,
    id,
    title: title || '未命名歌曲',
    artist: artist || '未知歌手',
    album: String(track?.album ?? '').trim() || '未知专辑',
    color: colorForTrack(track ?? {}),
    popularity,
    energy,
    genre,
    mood,
    genreFamily: genreFamily(genre),
    moodFamily: moodFamily(mood),
    tag: track?.tag || (fromPlaylist ? '来自你的歌单' : '探索发现'),
  };
}

function dayKey() {
  return new Date().toISOString().slice(0, 10);
}

function comparableKey(track) {
  return `${String(track?.title ?? '').trim().toLowerCase()}::${String(track?.artist ?? '').trim().toLowerCase()}`;
}

function artistKey(value) {
  return labelText(value).split(/\s*[/、,&]\s*/)[0];
}

export function buildTasteProfile(tracks = []) {
  const normalized = tracks.map((track) => normalizeTrack(track, true)).filter((track) => track.title);
  const genreCounts = new Map();
  const moodCounts = new Map();
  normalized.forEach((track) => {
    genreCounts.set(track.genreFamily, (genreCounts.get(track.genreFamily) ?? 0) + 1);
    moodCounts.set(track.moodFamily, (moodCounts.get(track.moodFamily) ?? 0) + 1);
  });
  const top = (counts) => [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([value]) => value);
  const average = (field, fallback) => normalized.length
    ? normalized.reduce((sum, track) => sum + track[field], 0) / normalized.length
    : fallback;
  return {
    genres: top(genreCounts),
    moods: top(moodCounts),
    energy: average('energy', 58),
    popularity: average('popularity', DEFAULT_POPULARITY),
    artists: new Set(normalized.map((track) => artistKey(track.artist)).filter(Boolean)),
    trackCount: normalized.length,
  };
}

function profileScore(track, profile) {
  if (!profile?.trackCount) return 0;
  const genreScore = profile.genres.includes(track.genreFamily) ? 1 : 0;
  const moodScore = profile.moods.includes(track.moodFamily) ? 1 : 0;
  const energyScore = 1 - clamp(Math.abs(track.energy - profile.energy) / 100, 0, 1);
  const popularityScore = 1 - clamp(Math.abs(track.popularity - profile.popularity) / 100, 0, 1);
  const newArtistScore = profile.artists.has(artistKey(track.artist)) ? 0 : 1;
  const chartScore = track.discoverySource === 'qq-chart' ? 0.08 : 0;
  return genreScore * 0.34 + moodScore * 0.24 + energyScore * 0.18 + popularityScore * 0.12 + newArtistScore * 0.12 + chartScore;
}

function stableDailyScore(track, profile) {
  const dailyVariation = (hash(`${dayKey()}:${track.id}`) % 1000) / 1000;
  const energyFit = 100 - Math.abs(track.energy - (profile?.energy ?? 55));
  return profile?.trackCount
    ? profileScore(track, profile) * 100 + track.popularity * 0.08 + dailyVariation * 8
    : track.popularity * 0.48 + energyFit * 0.22 + dailyVariation * 30;
}

export function hasRealPlaylistTracks(playlist) {
  return Array.isArray(playlist?.tracks) && playlist.tracks.length > 0;
}

export function buildRecommendations({ playlist, fallbackCandidates, amount, excluded = new Set(), rejected = new Set(), blockedTracks = [], sourceType = 'playlist', profile = null }) {
  const fromPlaylist = hasRealPlaylistTracks(playlist);
  const source = fromPlaylist ? playlist.tracks : fallbackCandidates;
  const blockedIds = new Set(blockedTracks.map((track) => String(track.id ?? track.qqMid ?? '')).filter(Boolean));
  const blockedKeys = new Set(blockedTracks.map(comparableKey));
  const isPlaylistSource = fromPlaylist && sourceType === 'playlist';
  const normalized = source
    .map((track) => normalizeTrack(track, isPlaylistSource))
    .filter((track) => track.title && !excluded.has(track.id) && !rejected.has(track.id) && !blockedIds.has(track.id) && !blockedKeys.has(comparableKey(track)));

  const eligible = normalized.filter((track) => track.popularity >= MIN_POPULARITY);
  const pool = (eligible.length >= amount ? eligible : normalized).sort((a, b) => stableDailyScore(b, profile) - stableDailyScore(a, profile));
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
