const SHORT_VIDEO_VIRAL_PATTERN = /(?:抖音|短视频|网红|热梗|喊麦|土嗨|社会摇|口水歌|洗脑神曲|神曲版|网络热歌|网络神曲|热歌版|爆款神曲)/i;

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function normalizeSimilarity(value, fallback = 0.5) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  if (number > 1) return clamp(number / 100);
  return clamp(number);
}

function candidateKey(title, artist) {
  return `${String(title ?? '').normalize('NFKC').trim().toLowerCase()}::${String(artist ?? '').normalize('NFKC').trim().toLowerCase()}`;
}

function inferLanguage(title, artist) {
  const text = `${title ?? ''} ${artist ?? ''}`;
  if (/[぀-ヿ]/u.test(text)) return 'ja';
  if (/[가-힯]/u.test(text)) return 'ko';
  if (/[㐀-鿿]/u.test(text)) return 'zh';
  if (/[a-z]/i.test(text)) return 'en';
  return 'other';
}

async function mapSettled(items, concurrency, mapper) {
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
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

async function lastFmRequest(apiKey, method, params = {}, fetchImpl = fetch) {
  if (!apiKey) throw new Error('请先在设置中填写 Last.fm API Key');
  const query = new URLSearchParams({ method, api_key: apiKey, format: 'json', autocorrect: '1', ...params });
  const response = await fetchImpl(`https://ws.audioscrobbler.com/2.0/?${query}`);
  if (!response.ok) throw new Error(`Last.fm 返回 HTTP ${response.status}`);
  const payload = await response.json();
  if (payload?.error) throw new Error(`Last.fm：${payload.message || `错误 ${payload.error}`}`);
  return payload;
}

function rotate(items, offset) {
  if (!items.length) return [];
  const safeOffset = ((Number(offset) || 0) % items.length + items.length) % items.length;
  return [...items.slice(safeOffset), ...items.slice(0, safeOffset)];
}

async function fetchLastFmCandidates({ seeds = [], apiKey, offset = 0, limit = 120, fetchImpl = fetch }) {
  const usableSeeds = rotate(seeds.filter((track) => track?.title && track?.artist), offset).slice(0, 8);
  const responses = await mapSettled(usableSeeds, 3, (seed) => lastFmRequest(apiKey, 'track.getSimilar', {
    track: seed.title,
    artist: String(seed.artist).split(/\s*[/、,&]\s*/)[0],
    limit: '24',
  }, fetchImpl));
  const candidates = new Map();
  responses.forEach((response, seedIndex) => {
    if (response.status !== 'fulfilled') return;
    const sourceSeed = usableSeeds[seedIndex];
    const tracks = response.value?.similartracks?.track ?? [];
    tracks.forEach((track) => {
      const title = track?.name;
      const artist = track?.artist?.name ?? track?.artist;
      const key = candidateKey(title, artist);
      if (!title || !artist || candidates.has(key)) return;
      candidates.set(key, {
        title,
        artist,
        similarity: normalizeSimilarity(track.match, 0.62),
        lastFmMatch: normalizeSimilarity(track.match, 0.62),
        discoverySource: 'lastfm-similar-track',
        sourceGroup: 'discovery',
        sourceSeed: `${sourceSeed.title} · ${sourceSeed.artist}`,
        tag: 'Last.fm 相似收听',
      });
    });
  });
  return [...candidates.values()].slice(0, Math.max(1, limit));
}

async function enrichLastFmInfo(candidates, apiKey, { fetchImpl = fetch, limit = 100 } = {}) {
  if (!apiKey) return [];
  const selected = candidates.slice(0, limit);
  const results = await mapSettled(selected, 4, async (candidate) => {
    const payload = await lastFmRequest(apiKey, 'track.getInfo', {
      track: candidate.title,
      artist: candidate.artist,
    }, fetchImpl);
    const info = payload?.track;
    const tags = (info?.toptags?.tag ?? []).map((tag) => String(tag?.name ?? '').trim()).filter(Boolean).slice(0, 8);
    return {
      ...candidate,
      lastFmListeners: Number(info?.listeners) || null,
      lastFmPlaycount: Number(info?.playcount) || null,
      lastFmTags: tags,
      language: candidate.language || inferLanguage(candidate.title, candidate.artist),
    };
  });
  return results.map((result, index) => result.status === 'fulfilled'
    ? result.value
    : { ...selected[index], lastFmListeners: null, lastFmPlaycount: null, lastFmTags: [], language: inferLanguage(selected[index].title, selected[index].artist) });
}

const AI_CANDIDATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    candidates: {
      type: 'array',
      maxItems: 60,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          artist: { type: 'string' },
          similarity: { type: 'number', minimum: 0, maximum: 1 },
          reason: { type: 'string' },
          mood: { type: 'string' },
          language: { type: 'string', enum: ['zh', 'en', 'ja', 'ko', 'other'] },
          is_short_video_novelty: { type: 'boolean' },
        },
        required: ['title', 'artist', 'similarity', 'reason', 'mood', 'language', 'is_short_video_novelty'],
      },
    },
  },
  required: ['candidates'],
};

function buildAiPrompt({ seeds = [], liked = [], disliked = [], mood = 'auto', language = 'auto' }) {
  const lines = seeds.slice(0, 60).map((track) => `- ${track.title} — ${track.artist}`).join('\n');
  const positive = liked.slice(0, 20).map((track) => `${track.title} — ${track.artist}`).join('；') || '暂无';
  const negative = disliked.slice(0, 20).map((track) => `${track.title} — ${track.artist}`).join('；') || '暂无';
  return `你是严谨的音乐推荐候选生成器。根据用户 QQ 音乐歌单和校准反馈，提出 40 首真实存在的歌曲。\n\n歌单样本：\n${lines}\n\n明确喜欢：${positive}\n明确不喜欢：${negative}\n当前心情：${mood}\n语言偏好：${language}\n\n要求：70% 高相似度且大众接受度高，30% 稍有探索性但必须是成熟正式发行；允许所有正常曲风；禁止 DJ 版、Live、Remix、加速、降速、片段、节目、短视频口水歌、喊麦、土嗨和低成本网络热梗歌曲；不要返回歌单中已有歌曲；不要虚构歌曲；similarity 表示与歌单画像的相似度。只输出符合给定 JSON Schema 的结果。`;
}

function normalizeAiCandidates(payload, provider) {
  const list = payload?.candidates ?? [];
  const unique = new Map();
  list.forEach((item) => {
    const title = String(item?.title ?? '').trim();
    const artist = String(item?.artist ?? '').trim();
    const key = candidateKey(title, artist);
    if (!title || !artist || unique.has(key) || item?.is_short_video_novelty) return;
    unique.set(key, {
      title,
      artist,
      similarity: normalizeSimilarity(item.similarity, 0.58),
      aiReason: String(item.reason ?? '').trim(),
      mood: String(item.mood ?? '').trim() || '待识别氛围',
      language: item.language || inferLanguage(title, artist),
      isShortVideoViral: Boolean(item.is_short_video_novelty),
      discoverySource: `ai-${provider}`,
      sourceGroup: 'discovery',
      tag: provider === 'openai' ? 'OpenAI 画像探索' : 'Gemini 画像探索',
    });
  });
  return [...unique.values()];
}

async function callGemini({ apiKey, model, prompt, fetchImpl = fetch }) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model || 'gemini-2.5-flash')}:generateContent`;
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', responseJsonSchema: AI_CANDIDATE_SCHEMA, temperature: 0.35 },
    }),
  });
  if (!response.ok) throw new Error(`Gemini 返回 HTTP ${response.status}`);
  const payload = await response.json();
  const text = payload?.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('') ?? '';
  return JSON.parse(text);
}

function normalizeOpenAiBaseUrl(value = 'https://api.openai.com/v1') {
  const baseUrl = String(value || 'https://api.openai.com/v1').trim().replace(/\/+$/, '');
  const parsed = new URL(baseUrl);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('OpenAI 兼容 API 地址必须使用 http 或 https');
  }
  return parsed.toString().replace(/\/+$/, '');
}

async function callOpenAI({ apiKey, model, prompt, baseUrl, fetchImpl = fetch }) {
  const response = await fetchImpl(`${normalizeOpenAiBaseUrl(baseUrl)}/responses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: model || 'gpt-5-mini',
      store: false,
      input: prompt,
      text: { format: { type: 'json_schema', name: 'music_candidates', strict: true, schema: AI_CANDIDATE_SCHEMA } },
    }),
  });
  if (!response.ok) throw new Error(`OpenAI 返回 HTTP ${response.status}`);
  const payload = await response.json();
  const text = payload?.output?.flatMap((item) => item?.content ?? []).find((item) => item?.type === 'output_text')?.text ?? payload?.output_text ?? '';
  return JSON.parse(text);
}

async function fetchAiCandidates({ provider, credentials, settings, seeds, liked, disliked, mood, language, fetchImpl = fetch }) {
  if (!provider || provider === 'off') return [];
  const prompt = buildAiPrompt({ seeds, liked, disliked, mood, language });
  if (provider === 'gemini') {
    if (!credentials?.geminiApiKey) return [];
    return normalizeAiCandidates(await callGemini({ apiKey: credentials.geminiApiKey, model: settings?.geminiModel, prompt, fetchImpl }), 'gemini');
  }
  if (provider === 'openai') {
    if (!credentials?.openAiApiKey) return [];
    return normalizeAiCandidates(await callOpenAI({ apiKey: credentials.openAiApiKey, model: settings?.openAiModel, baseUrl: settings?.openAiBaseUrl, prompt, fetchImpl }), 'openai');
  }
  return [];
}

function qualityTier(similarity) {
  const value = normalizeSimilarity(similarity, 0.5);
  if (value >= 0.75) return { name: 'high', minComments: 500, minListeners: 50000, minPlaycount: 200000 };
  if (value >= 0.5) return { name: 'medium', minComments: 1000, minListeners: 100000, minPlaycount: 500000 };
  return { name: 'explore', minComments: 2000, minListeners: 250000, minPlaycount: 1000000 };
}

function evaluateCandidateQuality(track) {
  const label = `${track?.title ?? ''} ${track?.artist ?? ''} ${track?.album ?? ''} ${(track?.lastFmTags ?? []).join(' ')}`;
  if (track?.isShortVideoViral || SHORT_VIDEO_VIRAL_PATTERN.test(label)) return { accepted: false, reason: 'short-video-novelty', signals: 0 };
  const tier = qualityTier(track?.similarity);
  const commentKnown = track?.commentCountVerified === true && Number.isFinite(Number(track.commentCount));
  const commentSignal = commentKnown && Number(track.commentCount) > tier.minComments;
  const listenerSignal = Number(track?.lastFmListeners) > tier.minListeners;
  const playcountSignal = Number(track?.lastFmPlaycount) > tier.minPlaycount;
  const chartSignal = track?.chartVerified === true;
  const signals = [commentSignal, listenerSignal, playcountSignal, chartSignal].filter(Boolean).length;
  const accepted = (!commentKnown || commentSignal) && signals >= 2;
  return {
    accepted,
    reason: commentKnown && !commentSignal ? 'qq-comments-below-tier' : (signals >= 2 ? 'verified' : 'insufficient-independent-signals'),
    signals,
    tier: tier.name,
    minComments: tier.minComments,
  };
}

module.exports = {
  AI_CANDIDATE_SCHEMA,
  candidateKey,
  enrichLastFmInfo,
  evaluateCandidateQuality,
  fetchAiCandidates,
  fetchLastFmCandidates,
  inferLanguage,
  normalizeSimilarity,
  normalizeOpenAiBaseUrl,
  qualityTier,
};
