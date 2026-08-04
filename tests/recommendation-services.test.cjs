const test = require('node:test');
const assert = require('node:assert/strict');
const {
  enrichLastFmInfo,
  evaluateCandidateQuality,
  fetchAiCandidates,
  fetchLastFmCandidates,
  normalizeOpenAiBaseUrl,
  qualityTier,
} = require('../electron/recommendation-services.cjs');

test('dynamic QQ comment floors follow similarity tiers', () => {
  assert.equal(qualityTier(0.8).minComments, 500);
  assert.equal(qualityTier(0.6).minComments, 1000);
  assert.equal(qualityTier(0.3).minComments, 2000);
});

test('known low QQ comments cannot be rescued by other popularity signals', () => {
  const result = evaluateCandidateQuality({
    title: 'Normal Song', artist: 'Known Artist', similarity: 0.8,
    commentCountVerified: true, commentCount: 200,
    lastFmListeners: 900000, lastFmPlaycount: 9000000, chartVerified: true,
  });
  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'qq-comments-below-tier');
});

test('missing QQ comments require two independent alternative signals', () => {
  const accepted = evaluateCandidateQuality({
    title: 'Normal Song', artist: 'Known Artist', similarity: 0.8,
    commentCountVerified: false, lastFmListeners: 80000, lastFmPlaycount: 300000,
  });
  const rejected = evaluateCandidateQuality({
    title: 'Normal Song', artist: 'Known Artist', similarity: 0.8,
    commentCountVerified: false, lastFmListeners: 80000, lastFmPlaycount: 1000,
  });
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.signals, 2);
  assert.equal(rejected.accepted, false);
});

test('short-video novelty is always rejected', () => {
  const result = evaluateCandidateQuality({
    title: '某某洗脑神曲版', artist: '网络歌手', similarity: 0.9,
    commentCountVerified: true, commentCount: 999999,
    lastFmListeners: 999999, lastFmPlaycount: 9999999, chartVerified: true,
  });
  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'short-video-novelty');
});

test('Last.fm candidate and popularity adapters parse official response shapes', async () => {
  const fetchImpl = async (url) => {
    const method = new URL(url).searchParams.get('method');
    return {
      ok: true,
      async json() {
        if (method === 'track.getSimilar') return { similartracks: { track: [{ name: 'Candidate', match: '0.82', artist: { name: 'Artist B' } }] } };
        return { track: { listeners: '123456', playcount: '987654', toptags: { tag: [{ name: 'pop' }, { name: 'female vocalists' }] } } };
      },
    };
  };
  const candidates = await fetchLastFmCandidates({ seeds: [{ title: 'Seed', artist: 'Artist A' }], apiKey: 'test', fetchImpl });
  const enriched = await enrichLastFmInfo(candidates, 'test', { fetchImpl });
  assert.equal(candidates[0].title, 'Candidate');
  assert.equal(candidates[0].similarity, 0.82);
  assert.equal(enriched[0].lastFmListeners, 123456);
  assert.deepEqual(enriched[0].lastFmTags, ['pop', 'female vocalists']);
});

test('OpenAI-compatible base URL routes requests to Groq without treating the URL as a key', async () => {
  assert.equal(normalizeOpenAiBaseUrl('https://api.groq.com/openai/v1/'), 'https://api.groq.com/openai/v1');
  let requestedUrl = '';
  let requestedHeaders = {};
  const candidates = await fetchAiCandidates({
    provider: 'openai',
    credentials: { openAiApiKey: 'real-test-key' },
    settings: { openAiBaseUrl: 'https://api.groq.com/openai/v1', openAiModel: 'llama-3.3-70b-versatile' },
    seeds: [{ title: 'Seed', artist: 'Artist A' }],
    liked: [],
    disliked: [],
    mood: 'auto',
    language: 'auto',
    fetchImpl: async (url, options) => {
      requestedUrl = url;
      requestedHeaders = options.headers;
      return {
        ok: true,
        async json() {
          return { output_text: JSON.stringify({ candidates: [{ title: 'New Song', artist: 'Artist B', similarity: 0.8, reason: 'similar', mood: 'calm', language: 'en', is_short_video_novelty: false }] }) };
        },
      };
    },
  });
  assert.equal(requestedUrl, 'https://api.groq.com/openai/v1/responses');
  assert.equal(requestedHeaders.Authorization, 'Bearer real-test-key');
  assert.equal(candidates[0].title, 'New Song');
});
