import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRecommendations, buildTasteProfile, isPreferredTrackVersion } from '../src/recommendation.js';

function candidate(index, similarity, overrides = {}) {
  return {
    id: `id-${index}`,
    qqMid: `mid-${index}`,
    title: `Song ${index}`,
    artist: `Artist ${index}`,
    album: 'Studio Album',
    similarity,
    qualitySignals: 3,
    commentCountVerified: true,
    commentCount: 5000,
    popularity: 80,
    ...overrides,
  };
}

test('bans live, DJ, remix, slowed, sped-up, snippets and programmes', () => {
  ['Live版', 'DJ版', 'Remix', '0.8x降调氛围版', 'Sped Up', '试听片段', '节目', '抖音网络热歌'].forEach((suffix) => {
    assert.equal(isPreferredTrackVersion({ title: `Song (${suffix})`, album: 'Album' }), false, suffix);
  });
  assert.equal(isPreferredTrackVersion({ title: 'Normal Song', album: 'Studio Album', durationSeconds: 220 }), true);
  assert.equal(isPreferredTrackVersion({ title: 'Short Song', album: 'Studio Album', durationSeconds: 45 }), false);
});

test('selects 70 percent insurance and 30 percent exploration for ten tracks', () => {
  const candidates = [
    ...Array.from({ length: 9 }, (_, index) => candidate(index, 0.82)),
    ...Array.from({ length: 6 }, (_, index) => candidate(index + 20, 0.45)),
  ];
  const tracks = buildRecommendations({ playlist: { tracks: [] }, fallbackCandidates: candidates, amount: 10, sourceType: 'discovery', profile: buildTasteProfile([]) });
  assert.equal(tracks.length, 10);
  assert.equal(tracks.filter((track) => track.tag === '保险热门').length, 7);
  assert.equal(tracks.filter((track) => track.tag === '个性探索').length, 3);
});

test('deduplicates titles and artists and excludes playlist originals', () => {
  const playlistTrack = { id: 'owned', title: 'Already Owned', artist: 'Owner' };
  const candidates = [
    candidate(1, 0.8, { title: 'Already Owned', artist: 'Owner' }),
    candidate(2, 0.8, { title: 'Unique', artist: 'Same Artist' }),
    candidate(3, 0.8, { title: 'Another', artist: 'Same Artist' }),
    candidate(4, 0.8, { title: 'Unique', artist: 'Different Artist' }),
    candidate(5, 0.8, { title: 'Fresh', artist: 'Fresh Artist' }),
  ];
  const tracks = buildRecommendations({ playlist: { tracks: [] }, fallbackCandidates: candidates, amount: 5, blockedTracks: [playlistTrack], sourceType: 'discovery', profile: buildTasteProfile([]) });
  assert.equal(tracks.some((track) => track.title === 'Already Owned' && track.artist === 'Owner'), false);
  assert.equal(new Set(tracks.map((track) => track.title)).size, tracks.length);
  assert.equal(new Set(tracks.map((track) => track.artist)).size, tracks.length);
});
