import { SEED_PLAYLISTS } from './data';
import { isPreferredTrackVersion } from './recommendation';

const KEY = 'daily-discovery-state-v1';

function cleanTracks(tracks = []) {
  return (Array.isArray(tracks) ? tracks : []).filter(isPreferredTrackVersion);
}

export function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (saved) {
      const history = (saved.history ?? []).map((entry) => {
        const tracks = cleanTracks(entry.tracks);
        return { ...entry, tracks, trackIds: tracks.map((track) => track.id) };
      });
      return {
        ...saved,
        recommendations: cleanTracks(saved.recommendations),
        history,
        discoveryCache: cleanTracks(saved.discoveryCache),
        settings: { background: '', ...(saved.settings ?? {}) },
        synced: saved.synced === true && saved.playlists?.some((playlist) => playlist.source === 'QQ 音乐 · 已同步'),
      };
    }
  } catch {
    // Ignore malformed local state and restore a clean local workspace.
  }

  return {
    playlists: SEED_PLAYLISTS,
    recommendations: [],
    history: [],
    feedback: {},
    discoveryCache: [],
    synced: false,
    settings: { background: '' },
  };
}

export function saveState(state) {
  localStorage.setItem(KEY, JSON.stringify(state));
}

export function daysSince(dateString) {
  const now = new Date();
  const date = new Date(dateString);
  return Math.floor((now - date) / 86400000);
}
