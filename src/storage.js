import { SEED_PLAYLISTS } from './data';
import { baseTitleKey, isPreferredTrackVersion } from './recommendation';

const KEY = 'daily-discovery-state-v1';
const DISCOVERY_QUALITY_VERSION = 3;
const DEFAULT_SETTINGS = {
  background: '',
  aiProvider: 'gemini',
  geminiModel: 'gemini-2.5-flash',
  openAiModel: 'gpt-5-mini',
  openAiBaseUrl: 'https://api.openai.com/v1',
  mood: 'auto',
  language: 'auto',
};

function normalizeFeedback(feedback = {}) {
  return Object.fromEntries(Object.entries(feedback).map(([id, entry]) => [id, typeof entry === 'string'
    ? { value: entry === 'skip' ? 'heard' : entry, at: new Date().toISOString() }
    : entry]));
}

function cleanTracks(tracks = []) {
  const unique = new Map();
  (Array.isArray(tracks) ? tracks : []).filter(isPreferredTrackVersion).forEach((track) => {
    const key = baseTitleKey(track.title) || String(track.id ?? track.qqMid ?? '');
    if (key && !unique.has(key)) unique.set(key, track);
  });
  return [...unique.values()];
}

export function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (saved) {
      const hasCurrentDiscoveryQuality = saved.discoveryQualityVersion === DISCOVERY_QUALITY_VERSION;
      const history = (hasCurrentDiscoveryQuality ? saved.history ?? [] : []).map((entry) => {
        const tracks = cleanTracks(entry.tracks);
        return { ...entry, tracks, trackIds: tracks.map((track) => track.id) };
      });
      return {
        ...saved,
        recommendations: hasCurrentDiscoveryQuality ? cleanTracks(saved.recommendations) : [],
        history,
        discoveryCache: hasCurrentDiscoveryQuality ? cleanTracks(saved.discoveryCache) : [],
        exposures: hasCurrentDiscoveryQuality ? (saved.exposures ?? {}) : {},
        calibration: saved.calibration ?? {},
        feedback: normalizeFeedback(saved.feedback),
        discoveryQualityVersion: DISCOVERY_QUALITY_VERSION,
        settings: { ...DEFAULT_SETTINGS, ...(saved.settings ?? {}) },
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
    exposures: {},
    calibration: {},
    discoveryQualityVersion: DISCOVERY_QUALITY_VERSION,
    synced: false,
    settings: DEFAULT_SETTINGS,
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
