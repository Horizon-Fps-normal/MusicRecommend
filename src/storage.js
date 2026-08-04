import { SEED_PLAYLISTS } from './data';

const KEY = 'daily-discovery-state-v1';

export function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (saved) return { ...saved, settings: { background: '', ...(saved.settings ?? {}) }, synced: saved.synced === true && saved.playlists?.some((playlist) => playlist.source === 'QQ 音乐 · 已同步') };
  } catch {
    // Ignore malformed local state and restore a clean local workspace.
  }

  return {
    playlists: SEED_PLAYLISTS,
    recommendations: [],
    history: [],
    feedback: {},
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
