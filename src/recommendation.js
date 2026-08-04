const DEFAULT_POPULARITY = 72;
const MIN_POPULARITY = 45;
const POPULAR_COVER_COMMENT_COUNT = 10000;
const LOW_QUALITY_VERSION_PATTERN = /(?:\blive\b|live\u7248|\u73b0\u573a|\u5b9e\u51b5|\u6f14\u5531\u4f1a|\u5de1\u56de\u6f14\u51fa|\u97f3\u4e50\u4f1a|concert\s*(?:version|live|recording|tour)|\bdj\b|dj\u7248|remix|rework|\bmix(?:ed)?\b|\u6df7\u97f3|\u6df7\u97f3\u7248|sped\s*up|speed\s*up|\u52a0\u901f|\u500d\u901f|\u5feb\u7248|\bslow(?:ed)?\b|slowed\s*\+?\s*reverb|\u6162\u901f|\u964d\u901f|\u964d\u8c03|\u5347\u8c03|\u53d8\u8c03|\u6c1b\u56f4\u7248|\u9ad8\u71c3|\u8d85\u71c3|\b(?:0?\.\d+|1\.\d+)x\b|clean\s*(?:ver(?:sion)?\.?)?|\u7247\u6bb5|\u8bd5\u542c|preview|snippet|\u94c3\u58f0|\u7247\u5934|\u7247\u5c3e|\u4f34\u594f|demo|\u8282\u76ee|\u64ad\u5ba2|\u6709\u58f0\u4e66|\u6717\u8bf5|\u76f8\u58f0|\u8131\u53e3\u79c0|\u8bbf\u8c08|\u8bb2\u89e3|\u89e3\u8bf4|\u5e7f\u64ad\u5267|\u6296\u97f3|\u77ed\u89c6\u9891|\u7f51\u7ea2|\u70ed\u6897|\u558a\u9ea6|\u571f\u55e8|\u793e\u4f1a\u6447|\u53e3\u6c34\u6b4c|\u6d17\u8111\u795e\u66f2|\u7f51\u7edc\u70ed\u6b4c|\u7f51\u7edc\u795e\u66f2)/i;

function normalizeIdentityText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/[\p{P}\p{S}\s]+/gu, '');
}

export function baseTitleKey(value) {
  return normalizeIdentityText(String(value ?? '')
    .normalize('NFKC')
    .replace(/\([^)]*\)|（[^）]*）|\[[^\]]*\]|【[^】]*】/g, '')
    .replace(/\s*[-–—]\s*(?:live|remix|mix|version|ver\.?|edit|radio edit|acoustic|\u4f34\u594f|\u6df7\u97f3|\u73b0\u573a|\u52a0\u901f|\u964d\u901f|\u964d\u8c03).*$/i, ''));
}

export function isPreferredTrackVersion(track) {
  const label = `${track?.title ?? track?.songname ?? ''} ${track?.album ?? track?.albumname ?? ''}`.normalize('NFKC').trim();
  if (LOW_QUALITY_VERSION_PATTERN.test(label)) return false;
  if (Number(track?.versionCode ?? track?.ver) === 3) return false;
  const duration = Number(track?.durationSeconds ?? track?.interval ?? 0);
  return !(Number.isFinite(duration) && duration > 0 && duration < 90);
}

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
  const tagText = Array.isArray(track?.lastFmTags) ? track.lastFmTags.join(' ') : '';
  const genre = track?.genre || track?.lastFmTags?.[0] || inferredGenre(track);
  const mood = track?.mood || inferredMood({ ...track, album: `${track?.album ?? ''} ${tagText}` });

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
    genreFamily: genreFamily(track?.genre || tagText || genre),
    moodFamily: moodFamily(`${mood} ${tagText}`),
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
  return normalizeIdentityText(labelText(value).split(/\s*[/、,&]\s*/)[0]);
}

function artistKeys(value) {
  return String(value ?? '').split(/\s*[/、,&]\s*/).map(normalizeIdentityText).filter(Boolean);
}

function artistsOverlap(first, second) {
  const firstKeys = new Set(artistKeys(first));
  return artistKeys(second).some((key) => firstKeys.has(key));
}

export function buildTasteProfile(tracks = [], calibration = {}, preferences = {}) {
  const allTracks = tracks.map((track) => normalizeTrack(track, true)).filter((track) => track.title);
  const normalized = allTracks.filter((track) => calibration[track.id] !== 'dislike');
  const genreCounts = new Map();
  const moodCounts = new Map();
  allTracks.forEach((track) => {
    const weight = calibration[track.id] === 'like' ? 3 : calibration[track.id] === 'dislike' ? -2 : 1;
    genreCounts.set(track.genreFamily, (genreCounts.get(track.genreFamily) ?? 0) + weight);
    moodCounts.set(track.moodFamily, (moodCounts.get(track.moodFamily) ?? 0) + weight);
  });
  const top = (counts) => [...counts.entries()].filter(([, count]) => count > 0).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([value]) => value);
  const average = (field, fallback) => normalized.length
    ? normalized.reduce((sum, track) => sum + track[field], 0) / normalized.length
    : fallback;
  return {
    genres: top(genreCounts),
    moods: top(moodCounts),
    energy: average('energy', 58),
    popularity: average('popularity', DEFAULT_POPULARITY),
    artists: new Set(normalized.map((track) => artistKey(track.artist)).filter(Boolean)),
    dislikedArtists: new Set(allTracks.filter((track) => calibration[track.id] === 'dislike').map((track) => artistKey(track.artist)).filter(Boolean)),
    trackCount: normalized.length,
    selectedMood: preferences.mood ?? 'auto',
    selectedLanguage: preferences.language ?? 'auto',
  };
}

function profileScore(track, profile) {
  if (!profile?.trackCount) return 0;
  const genreScore = profile.genres.includes(track.genreFamily) ? 1 : 0;
  const moodScore = profile.moods.includes(track.moodFamily) ? 1 : 0;
  const energyScore = 1 - clamp(Math.abs(track.energy - profile.energy) / 100, 0, 1);
  const popularityScore = 1 - clamp(Math.abs(track.popularity - profile.popularity) / 100, 0, 1);
  const newArtistScore = profile.artists.has(artistKey(track.artist)) ? 0 : 1;
  const dislikedArtistPenalty = profile.dislikedArtists?.has(artistKey(track.artist)) ? 0.35 : 0;
  const selectedMoodScore = !profile.selectedMood || profile.selectedMood === 'auto'
    ? 0.5
    : labelText(`${track.mood} ${(track.lastFmTags ?? []).join(' ')}`).includes(labelText(profile.selectedMood)) ? 1 : 0.25;
  const selectedLanguageScore = !profile.selectedLanguage || ['auto', 'mixed'].includes(profile.selectedLanguage)
    ? 0.5
    : profile.selectedLanguage === 'ja-ko'
      ? ['ja', 'ko'].includes(track.language) ? 1 : 0
      : track.language === profile.selectedLanguage ? 1 : 0;
  const chartScore = track.chartVerified ? 0.08 : 0;
  return genreScore * 0.22 + moodScore * 0.16 + energyScore * 0.14 + popularityScore * 0.08 + newArtistScore * 0.12 + selectedMoodScore * 0.16 + selectedLanguageScore * 0.12 + chartScore - dislikedArtistPenalty;
}

function stableDailyScore(track, profile) {
  const dailyVariation = (hash(`${dayKey()}:${track.id}`) % 1000) / 1000;
  const energyFit = 100 - Math.abs(track.energy - (profile?.energy ?? 55));
  const similarity = clamp(Number(track.similarity) || 0.5, 0, 1);
  const quality = clamp((Number(track.qualitySignals) || 0) / 4, 0, 1);
  return profile?.trackCount
    ? similarity * 52 + profileScore(track, profile) * 32 + quality * 12 + track.popularity * 0.04 + dailyVariation * 4
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
  const blockedTitles = new Map();
  blockedTracks.forEach((track) => {
    const title = baseTitleKey(track.title);
    if (!title) return;
    if (!blockedTitles.has(title)) blockedTitles.set(title, []);
    blockedTitles.get(title).push(track.artist);
  });
  const isPlaylistSource = fromPlaylist && sourceType === 'playlist';
  const normalized = source
    .map((track) => normalizeTrack(track, isPlaylistSource))
    .filter((track) => {
      if (!isPreferredTrackVersion(track) || !track.title || excluded.has(track.id) || rejected.has(track.id) || blockedIds.has(track.id) || blockedKeys.has(comparableKey(track))) return false;
      if (sourceType === 'discovery' && Number(track.qualitySignals) < 2) return false;
      const blockedArtists = blockedTitles.get(baseTitleKey(track.title));
      if (!blockedArtists?.length) return true;
      if (blockedArtists.some((artist) => artistsOverlap(artist, track.artist))) return false;
      return track.commentCountVerified === true && Number(track.commentCount) >= POPULAR_COVER_COMMENT_COUNT;
    });

  const eligible = normalized.filter((track) => track.popularity >= MIN_POPULARITY);
  const pool = (eligible.length >= amount ? eligible : normalized).sort((a, b) => stableDailyScore(b, profile) - stableDailyScore(a, profile));
  const picked = [];
  const artists = new Set();
  const titles = new Set();
  const addDistinct = (track) => {
    const title = baseTitleKey(track.title);
    const artist = artistKey(track.artist);
    if (!title || titles.has(title) || artists.has(artist)) return false;
    picked.push({ ...track, tag: track.tag === '高热度翻唱' ? track.tag : Number(track.similarity) >= 0.65 ? '保险热门' : '个性探索' });
    artists.add(artistKey(track.artist));
    titles.add(title);
    return true;
  };

  const insuranceTarget = Math.max(1, Math.round(amount * 0.7));
  const insurancePool = pool.filter((track) => Number(track.similarity) >= 0.65);
  const explorationPool = pool.filter((track) => Number(track.similarity) < 0.65);

  for (const track of insurancePool) {
    addDistinct(track);
    if (picked.length >= insuranceTarget) break;
  }

  const explorationTarget = amount - picked.length;
  let explored = 0;
  for (const track of explorationPool) {
    if (addDistinct(track)) explored += 1;
    if (explored >= explorationTarget || picked.length >= amount) break;
  }

  if (picked.length >= amount) return picked;

  // Keep the version and quality floors, but relax the 70/30 lane when one side
  // cannot fill its quota.
  for (const track of pool) {
    addDistinct(track);
    if (picked.length >= amount) break;
  }

  return picked;
}
