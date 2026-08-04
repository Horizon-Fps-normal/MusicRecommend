import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpRight,
  AlertCircle,
  Ban,
  Bookmark,
  Check,
  ChevronDown,
  CircleHelp,
  ExternalLink,
  Heart,
  History as HistoryIcon,
  ImagePlus,
  KeyRound,
  LibraryBig,
  Link2,
  Music2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  ThumbsUp,
  WandSparkles,
  X,
} from 'lucide-react';
import { CANDIDATES, NAV_ITEMS } from './data';
import { baseTitleKey, buildRecommendations, buildTasteProfile, hasRealPlaylistTracks, isPreferredTrackVersion } from './recommendation';
import { daysSince, loadState, saveState } from './storage';
import packageInfo from '../package.json';
import appIcon from '../assets/daily-discovery-icon-512.png';

const ICONS = { sparkles: Sparkles, library: LibraryBig, history: HistoryIcon, heart: Heart };

function todayLabel() {
  return new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date());
}

function timeLabel(dateString = new Date().toISOString()) {
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(new Date(dateString));
}

function cleanErrorMessage(error, fallback) {
  const message = String(error?.message ?? '').replace(/^Error invoking remote method '[^']+': Error: /, '').replace(/^Error: /, '').trim();
  return message || fallback;
}

function isErrorNotice(message) {
  return /error|失败|无法|不可用|错误|没有找到|请检查/i.test(String(message ?? ''));
}

function feedbackValue(entry) {
  return typeof entry === 'string' ? entry : entry?.value;
}

function feedbackDate(entry) {
  return typeof entry === 'object' && entry?.at ? entry.at : null;
}

function mergeDiscoveryCandidates(...collections) {
  const merged = new Map();
  collections.flat().filter((track) => isPreferredTrackVersion(track) && Number(track.qualitySignals) >= 2).forEach((track) => {
    const key = baseTitleKey(track.title) || String(track.id ?? track.qqMid ?? '').toLowerCase();
    const current = merged.get(key);
    const score = Number(track.similarity) * 100 + Number(track.qualitySignals) * 10 + Math.log10(Number(track.commentCount) + 1);
    const currentScore = current ? Number(current.similarity) * 100 + Number(current.qualitySignals) * 10 + Math.log10(Number(current.commentCount) + 1) : -1;
    if (key && (!current || score > currentScore)) merged.set(key, track);
  });
  return [...merged.values()].slice(0, 1000);
}

function calibrationSample(tracks = [], size = 30) {
  if (tracks.length <= size) return tracks;
  const sampled = [];
  const used = new Set();
  for (let index = 0; index < size; index += 1) {
    const track = tracks[Math.floor(index * tracks.length / size)];
    if (track && !used.has(track.id)) {
      used.add(track.id);
      sampled.push(track);
    }
  }
  return sampled;
}

function Cover({ track, small = false, onClick }) {
  const [imageBroken, setImageBroken] = useState(false);
  return (
    <div className={`cover ${small ? 'cover-small' : ''} ${onClick ? 'clickable-cover' : ''}`} style={{ '--cover': track.color }} onClick={onClick} title={onClick ? '在 QQ 音乐中播放' : undefined}>
      {track.cover && !imageBroken ? <img className="cover-image" src={track.cover} alt={`${track.title} 封面`} onError={() => setImageBroken(true)} /> : null}
      <div className="cover-shade" />
      <span className="cover-kicker">{track.cover && !imageBroken ? 'QQ MUSIC' : 'DAILY'}</span>
      <Music2 size={small ? 19 : 30} strokeWidth={1.4} />
      <span className="cover-title">{track.title}</span>
    </div>
  );
}

function StatusPill({ children, tone = 'neutral' }) {
  return <span className={`status-pill status-${tone}`}><span className="status-dot" />{children}</span>;
}

function PreferenceSelect({ label, value, onChange, options }) {
  return (
    <label className="preference-select">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

function ServiceStatus({ configured, children }) {
  return <StatusPill tone={configured ? 'green' : 'amber'}>{children} · {configured ? '已配置' : '未配置'}</StatusPill>;
}

function EmptyState({ onGenerate }) {
  return (
    <div className="empty-state">
      <div className="empty-orbit"><WandSparkles size={34} /></div>
      <h3>今天还没有发现</h3>
      <p>输入一个数量，让你的收藏替你打开一扇新的音乐窗口。</p>
      <button className="primary-button" onClick={onGenerate}><Sparkles size={17} />生成今日推荐</button>
    </div>
  );
}

function RecommendationCard({ track, feedback, onAction, onReplace, onPlay }) {
  const selected = feedbackValue(feedback?.[track.id]);
  const canPlayInApp = Boolean(track.playbackUrl);
  return (
    <article className={`track-card ${selected ? 'has-feedback' : ''}`}>
      <div className="card-topline"><span className="match-label">{track.tag}</span><span className="match-score">{Math.round(Math.max(0, Math.min(1, Number(track.similarity) || 0.5)) * 100)}% 画像相似</span></div>
      <Cover track={track} onClick={() => onPlay(track)} />
      <div className="track-info">
        <div className="track-heading"><div><h3>{track.title}</h3><p>{track.artist}</p></div><button className="icon-button" title="打开 QQ 音乐网页" onClick={() => window.open(track.url || `https://y.qq.com/n/ryqq/search?w=${encodeURIComponent(`${track.title} ${track.artist}`)}`, '_blank')}><ExternalLink size={16} /></button></div>
        <div className="track-meta"><span>{track.album}</span><span>{track.genre}</span>{track.commentCountVerified ? <span>{track.commentCount.toLocaleString('zh-CN')} 条评论</span> : null}</div>
        <div className="card-actions">
          <button className="play-button" onClick={() => onPlay(track)}>{canPlayInApp ? <Play size={13} fill="currentColor" /> : <ExternalLink size={13} />}{canPlayInApp ? '播放' : '打开 QQ 音乐'}</button>
          <button className={`action-button ${selected === 'like' ? 'active-like' : ''}`} title="喜欢" onClick={() => onAction(track.id, 'like')}><ThumbsUp size={15} /></button>
          <button className={`action-button ${selected === 'favorite' ? 'active-save' : ''}`} title="收藏" onClick={() => onAction(track.id, 'favorite')}><Bookmark size={15} /></button>
          <button className={`action-button ${selected === 'heard' ? 'active-heard' : ''}`} title="已听过" onClick={() => onAction(track.id, 'heard')}><Check size={15} /></button>
          <button className={`action-button ${selected === 'dislike' ? 'active-dislike' : ''}`} title="不感兴趣" onClick={() => onAction(track.id, 'dislike')}><Ban size={15} /></button>
          <button className="replace-button" onClick={() => onReplace(track.id)}><RefreshCw size={14} />换一首</button>
        </div>
      </div>
    </article>
  );
}

function formatPlaybackTime(value = 0) {
  const seconds = Math.max(0, Math.floor(Number(value) || 0));
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
}

function PlaybackBar({ player, isPlaying, currentTime, duration, onToggle, onSeek, onOpenWeb, onClose }) {
  if (!player?.track) return null;
  const { track } = player;
  return (
    <div className="playback-bar" role="region" aria-label="应用内播放器">
      <div className="playback-track-info"><Cover track={track} small /><div><strong>{track.title}</strong><span>{track.artist || '未知歌手'}</span></div></div>
      <button className="playback-toggle" onClick={onToggle} title={isPlaying ? '暂停' : '播放'}>{isPlaying ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}</button>
      <div className="playback-progress"><div className="playback-time"><span>{formatPlaybackTime(currentTime)}</span><span>{formatPlaybackTime(duration)}</span></div><input type="range" min="0" max={duration || 0} step="0.1" value={Math.min(currentTime, duration || 0)} onChange={(event) => onSeek(Number(event.target.value))} aria-label="播放进度" /></div>
      <button className="action-button" onClick={onOpenWeb} title="在 QQ 音乐网页打开"><ExternalLink size={15} /></button>
      <button className="action-button" onClick={onClose} title="关闭播放器"><X size={15} /></button>
    </div>
  );
}

function App() {
  const [state, setState] = useState(loadState);
  const [view, setView] = useState('discover');
  const [count, setCount] = useState(10);
  const [sourceId, setSourceId] = useState(state.playlists[0]?.id ?? '');
  const [showSourceMenu, setShowSourceMenu] = useState(false);
  const [link, setLink] = useState('');
  const [notice, setNotice] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState(null);
  const [playlistSearch, setPlaylistSearch] = useState('');
  const [newTrackQuery, setNewTrackQuery] = useState('');
  const [editingPlaylistId, setEditingPlaylistId] = useState(null);
  const [playlistNameDraft, setPlaylistNameDraft] = useState('');
  const [player, setPlayer] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackTime, setPlaybackTime] = useState(0);
  const [playbackDuration, setPlaybackDuration] = useState(0);
  const [credentialDraft, setCredentialDraft] = useState({ lastFmApiKey: '', geminiApiKey: '', openAiApiKey: '' });
  const [credentialStatus, setCredentialStatus] = useState({ lastFmConfigured: false, geminiConfigured: false, openAiConfigured: false, encryptionAvailable: true });
  const [isSavingCredentials, setIsSavingCredentials] = useState(false);
  const audioRef = useRef(null);
  const prefetchSourceRef = useRef('');

  const activePlaylist = state.playlists.find((playlist) => playlist.id === sourceId) ?? state.playlists[0];
  const usingRealPlaylist = hasRealPlaylistTracks(activePlaylist);
  const tasteProfile = useMemo(() => buildTasteProfile(activePlaylist?.tracks ?? [], state.calibration ?? {}, state.settings ?? {}), [activePlaylist, state.calibration, state.settings]);
  const detailPlaylist = state.playlists.find((playlist) => playlist.id === selectedPlaylistId);
  const detailTracks = (detailPlaylist?.tracks ?? []).filter((track) => `${track.title} ${track.artist} ${track.album}`.toLowerCase().includes(playlistSearch.trim().toLowerCase()));
  const feedbackValues = Object.values(state.feedback).map(feedbackValue);
  const feedbackCount = feedbackValues.length;
  const likedCount = feedbackValues.filter((value) => value === 'like' || value === 'favorite').length;
  const feedbackTracks = useMemo(() => {
    const tracks = new Map();
    [...state.playlists.flatMap((playlist) => playlist.tracks ?? []), ...state.history.flatMap((entry) => entry.tracks ?? []), ...CANDIDATES]
      .forEach((track) => tracks.set(track.id, track));
    return tracks;
  }, [state.playlists, state.history]);
  const calibrationTracks = useMemo(() => calibrationSample(activePlaylist?.tracks ?? []), [activePlaylist]);
  const calibrationCompleted = calibrationTracks.length > 0 && calibrationTracks.every((track) => state.calibration?.[track.id]);

  useEffect(() => {
    window.qqMusic?.credentialStatus?.().then(setCredentialStatus).catch(() => {});
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !player?.src) return undefined;
    audio.src = player.src;
    audio.load();
    setPlaybackTime(0);
    setPlaybackDuration(0);
    audio.play().then(() => setIsPlaying(true)).catch(() => {
      setIsPlaying(false);
      setNotice('应用内播放被音频服务拒绝，请改用 QQ 音乐网页播放');
    });
    return () => audio.pause();
  }, [player?.src]);

  const recentExcluded = useMemo(() => {
    const excluded = new Set();
    Object.entries(state.exposures ?? {}).forEach(([id, date]) => {
      if (daysSince(date) < 7) excluded.add(id);
    });
    Object.entries(state.feedback ?? {}).forEach(([id, entry]) => {
      const value = feedbackValue(entry);
      if (['like', 'favorite', 'dislike'].includes(value)) excluded.add(id);
      if (value === 'heard' && (!feedbackDate(entry) || daysSince(feedbackDate(entry)) < 90)) excluded.add(id);
    });
    return excluded;
  }, [state.exposures, state.feedback]);

  const recentHistoryTracks = useMemo(() => {
    const tracks = new Map();
    state.history.flatMap((entry) => entry.tracks ?? []).forEach((track) => {
      if (recentExcluded.has(track.id)) tracks.set(track.id, track);
    });
    return [...tracks.values()];
  }, [state.history, recentExcluded]);

  useEffect(() => {
    const prefetchKey = `${sourceId}:${credentialStatus.lastFmConfigured}:${calibrationCompleted}`;
    if (!usingRealPlaylist || !credentialStatus.lastFmConfigured || prefetchSourceRef.current === prefetchKey || (state.discoveryCache?.length ?? 0) >= 300) return undefined;
    prefetchSourceRef.current = prefetchKey;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const first = await discoverExternalCandidates(10, 0);
      if (cancelled || first.length === 0) return;
      setState((current) => {
        const next = { ...current, discoveryCache: mergeDiscoveryCandidates(first, current.discoveryCache ?? []) };
        saveState(next);
        return next;
      });
    }, 1200);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [sourceId, usingRealPlaylist, credentialStatus.lastFmConfigured, calibrationCompleted]);

  function commit(next) {
    setState(next);
    saveState(next);
  }

  function updateSetting(key, value) {
    commit({ ...state, settings: { ...(state.settings ?? {}), [key]: value } });
  }

  function updateCalibration(trackId, value) {
    commit({ ...state, calibration: { ...(state.calibration ?? {}), [trackId]: value } });
  }

  async function saveCredentials() {
    if (!window.qqMusic?.saveCredentials || isSavingCredentials) return;
    setIsSavingCredentials(true);
    try {
      const status = await window.qqMusic.saveCredentials(credentialDraft);
      setCredentialStatus(status);
      setCredentialDraft({ lastFmApiKey: '', geminiApiKey: '', openAiApiKey: '' });
      prefetchSourceRef.current = '';
      setNotice('API 凭据已使用 Windows 系统加密保存在本机');
    } catch (error) {
      setNotice(cleanErrorMessage(error, 'API 凭据保存失败'));
    } finally {
      setIsSavingCredentials(false);
    }
    setTimeout(() => setNotice(''), 3000);
  }

  function togglePlayback() {
    const audio = audioRef.current;
    if (!audio || !player?.src) return;
    if (audio.paused) audio.play().then(() => setIsPlaying(true)).catch(() => setNotice('应用内播放失败，请改用 QQ 音乐网页播放'));
    else { audio.pause(); setIsPlaying(false); }
  }

  function seekPlayback(value) {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = value;
    setPlaybackTime(value);
  }

  function openTrackWeb(track) {
    const url = track?.url || `https://y.qq.com/n/ryqq/search?w=${encodeURIComponent(`${track?.title ?? ''} ${track?.artist ?? ''}`)}`;
    window.open(url, '_blank');
  }

  function openPlaylist(playlistId) {
    setSelectedPlaylistId(playlistId);
    setSourceId(playlistId);
    setPlaylistSearch('');
    setView('playlist-detail');
  }

  function beginRename(playlist) {
    setEditingPlaylistId(playlist.id);
    setPlaylistNameDraft(playlist.name);
  }

  function savePlaylistName(playlistId) {
    const name = playlistNameDraft.trim();
    if (!name) return;
    const next = { ...state, playlists: state.playlists.map((playlist) => playlist.id === playlistId ? { ...playlist, name } : playlist) };
    commit(next);
    setEditingPlaylistId(null);
    setNotice('歌单名称已保存');
    setTimeout(() => setNotice(''), 2000);
  }

  function deletePlaylist(playlistId) {
    const playlist = state.playlists.find((item) => item.id === playlistId);
    if (!playlist || !window.confirm(`确定删除本地歌单「${playlist.name}」吗？QQ 音乐中的原歌单不会被删除。`)) return;
    const playlists = state.playlists.filter((item) => item.id !== playlistId);
    const next = { ...state, playlists };
    commit(next);
    setSelectedPlaylistId(null);
    setSourceId(playlists[0]?.id ?? '');
    setView('playlists');
    setNotice('本地歌单已删除');
    setTimeout(() => setNotice(''), 2200);
  }

  function removeTrackFromPlaylist(playlistId, trackId) {
    const next = { ...state, playlists: state.playlists.map((playlist) => {
      if (playlist.id !== playlistId) return playlist;
      const tracks = (playlist.tracks ?? []).filter((track) => track.id !== trackId);
      return { ...playlist, tracks, count: tracks.length };
    }) };
    commit(next);
    setNotice('歌曲已从本地歌单移除');
    setTimeout(() => setNotice(''), 2000);
  }

  async function resyncPlaylist(playlist) {
    if (!playlist?.url || !window.qqMusic?.importPublicPlaylist) {
      setNotice('请在桌面版中使用公开链接重新同步');
      setTimeout(() => setNotice(''), 2400);
      return;
    }
    try {
      setNotice('正在重新同步 QQ 音乐歌单…');
      const imported = await window.qqMusic.importPublicPlaylist(playlist.url);
      const next = { ...state, playlists: state.playlists.map((item) => item.id === playlist.id ? { ...imported, id: playlist.id, name: playlist.name } : item), synced: true };
      commit(next);
      setNotice(`已同步 ${imported.count} 首歌曲`);
    } catch (error) {
      setNotice(cleanErrorMessage(error, '同步失败，请检查歌单链接'));
    }
    setTimeout(() => setNotice(''), 3000);
  }

  async function addTrackToPlaylist(playlist) {
    const query = newTrackQuery.trim();
    if (!query) return;
    if (!window.qqMusic?.resolveTrack) {
      setNotice('请在桌面版中添加歌曲');
      setTimeout(() => setNotice(''), 2200);
      return;
    }
    try {
      setNotice('正在搜索歌曲…');
      const resolved = await window.qqMusic.resolveTrack({ title: query, artist: '' });
      if (!resolved?.qqMid) throw new Error('没有找到匹配歌曲');
      const track = { ...resolved, id: resolved.qqMid, title: resolved.title || query, artist: resolved.artist || '', album: resolved.album || '', color: '#7186b4', tag: '手动添加', popularity: 80, energy: 55 };
      const next = { ...state, playlists: state.playlists.map((item) => item.id === playlist.id ? { ...item, tracks: [...(item.tracks ?? []).filter((old) => old.id !== track.id), track], count: [...(item.tracks ?? []).filter((old) => old.id !== track.id), track].length } : item) };
      commit(next);
      setNewTrackQuery('');
      setNotice(`已添加「${track.title}」`);
    } catch (error) {
      setNotice(cleanErrorMessage(error, '添加歌曲失败'));
    }
    setTimeout(() => setNotice(''), 2600);
  }

  function buildDailyRecommendations(amount, excluded = new Set(), externalCandidates = []) {
    const rejected = new Set(Object.entries(state.feedback).filter(([, entry]) => feedbackValue(entry) === 'dislike').map(([id]) => id));
    return buildRecommendations({
      playlist: usingRealPlaylist ? { tracks: [] } : activePlaylist,
      fallbackCandidates: usingRealPlaylist ? externalCandidates : CANDIDATES,
      amount,
      excluded,
      rejected,
      blockedTracks: usingRealPlaylist ? activePlaylist.tracks : [],
      sourceType: usingRealPlaylist ? 'discovery' : 'demo',
      profile: tasteProfile,
    });
  }

  async function discoverExternalCandidates(amount, pageOffset = 0) {
    if (!usingRealPlaylist || !window.qqMusic?.discoverTracks) return [];
    const seeds = activePlaylist.tracks.filter((track) => track.artist && track.title);
    if (seeds.length === 0) return [];
    const seedPageCount = Math.max(1, Math.ceil(seeds.length / 8));
    const seedPage = (Math.floor(Date.now() / 86400000) + recentExcluded.size) % seedPageCount;
    const likedSeeds = seeds.filter((track) => state.calibration?.[track.id] === 'like');
    const dislikedSeeds = seeds.filter((track) => state.calibration?.[track.id] === 'dislike');
    Object.entries(state.feedback ?? {}).forEach(([id, entry]) => {
      const track = feedbackTracks.get(id);
      if (!track) return;
      if (['like', 'favorite'].includes(feedbackValue(entry))) likedSeeds.push(track);
      if (feedbackValue(entry) === 'dislike') dislikedSeeds.push(track);
    });
    try {
      return await window.qqMusic.discoverTracks({
        seeds,
        likedSeeds,
        dislikedSeeds,
        playlistTracks: activePlaylist.tracks,
        excludedTracks: [...activePlaylist.tracks, ...recentHistoryTracks],
        pageStart: seedPage + pageOffset + 1,
        limit: Math.min(1000, Math.max(80, amount * 20)),
        requestedAmount: amount,
        includeAi: pageOffset === 0,
        settings: {
          aiProvider: state.settings?.aiProvider ?? 'gemini',
          geminiModel: state.settings?.geminiModel ?? 'gemini-2.5-flash',
          openAiModel: state.settings?.openAiModel ?? 'gpt-5-mini',
          openAiBaseUrl: state.settings?.openAiBaseUrl ?? 'https://api.openai.com/v1',
        },
        mood: state.settings?.mood ?? 'auto',
        language: state.settings?.language ?? 'auto',
      });
    } catch {
      return [];
    }
  }

  async function enrichTracks(tracks) {
    if (!window.qqMusic?.resolveTrack) return tracks;
    const enriched = await Promise.all(tracks.map(async (track) => {
      if (track.qqMid && track.cover) return track;
      try {
        const resolved = await window.qqMusic.resolveTrack({ title: track.title, artist: track.artist });
        const merged = resolved ? { ...track, ...resolved } : track;
        return isPreferredTrackVersion(merged) ? merged : track;
      } catch {
        return track;
      }
    }));
    return enriched;
  }

  async function generate() {
    const requested = Math.max(1, Math.min(10, Number(count) || 1));
    if (usingRealPlaylist && !credentialStatus.lastFmConfigured) {
      setView('settings');
      setNotice('请先在设置中填写 Last.fm API Key，再生成经过热度验证的推荐');
      setTimeout(() => setNotice(''), 3600);
      return;
    }
    setIsGenerating(true);
    setNotice(usingRealPlaylist ? '正在综合曲风、节奏、氛围与热度寻找歌单外新歌…' : '正在匹配 QQ 音乐封面与播放信息…');
    let externalCandidates = mergeDiscoveryCandidates(state.discoveryCache ?? []);
    let selectedTracks = buildDailyRecommendations(requested, recentExcluded, externalCandidates);
    const pageOffsets = usingRealPlaylist ? [0] : [];
    for (let index = 0; index < pageOffsets.length && selectedTracks.length < requested; index += 1) {
      setNotice(`正在搜索第 ${index + 1} 批候选，并核验评论热度与版本质量…`);
      const fetchedCandidates = await discoverExternalCandidates(requested, pageOffsets[index]);
      externalCandidates = mergeDiscoveryCandidates(fetchedCandidates, externalCandidates);
      selectedTracks = buildDailyRecommendations(requested, recentExcluded, externalCandidates);
    }
    const tracks = await enrichTracks(selectedTracks);
    const createdAt = new Date().toISOString();
    const entry = { id: `history-${Date.now()}`, createdAt, source: activePlaylist?.name ?? '常听收藏', requested, trackIds: tracks.map((track) => track.id), tracks };
    const exposures = { ...(state.exposures ?? {}) };
    tracks.forEach((track) => { exposures[track.id] = createdAt; });
    const next = { ...state, recommendations: tracks, history: [entry, ...state.history].slice(0, 50), discoveryCache: externalCandidates, exposures };
    commit(next);
    setIsGenerating(false);
    const resultLabel = tracks.length < requested
      ? `严格过滤后已生成 ${tracks.length} 首（目标 ${requested} 首）；未用冷门或改版歌曲凑数`
      : `${externalCandidates.length ? '已基于歌单画像探索不同歌手的新歌' : usingRealPlaylist ? '未找到足够歌单外歌曲，使用备用探索池' : '当前使用演示候选生成'} ${tracks.length} 首今日推荐`;
    setNotice(resultLabel);
    setTimeout(() => setNotice(''), 2600);
  }

  function action(trackId, value) {
    const next = { ...state, feedback: { ...state.feedback, [trackId]: { value, at: new Date().toISOString() } } };
    commit(next);
    setNotice(value === 'dislike' ? '已加入不感兴趣，后续会降低相似推荐' : '反馈已保存，会影响后续推荐');
    setTimeout(() => setNotice(''), 2400);
  }

  async function playTrack(track) {
    const webUrl = track.url || `https://y.qq.com/n/ryqq/search?w=${encodeURIComponent(`${track.title} ${track.artist}`)}`;
    if (window.qqMusic?.playTrack) {
      try {
        let qqMid = track.qqMid;
        let resolvedTrack = track;
        if (!qqMid && window.qqMusic.resolveTrack) {
          setNotice('正在匹配 QQ 音乐歌曲…');
          resolvedTrack = { ...track, ...(await window.qqMusic.resolveTrack({ title: track.title, artist: track.artist }) ?? {}) };
          qqMid = resolvedTrack.qqMid;
        }
        const result = await window.qqMusic.playTrack({ qqMid, audioUrl: resolvedTrack.playbackUrl, webUrl });
        if (result?.mode === 'in-app-audio') {
          setPlayer({ track: resolvedTrack, src: result.audioUrl });
          setNotice(`正在应用内播放：${resolvedTrack.title}`);
        } else if (result?.mode === 'web-fallback') {
          audioRef.current?.pause();
          setPlayer(null);
          setIsPlaying(false);
          setNotice('当前未配置 QQ 音乐授权播放服务，已打开歌曲网页');
        } else {
          audioRef.current?.pause();
          setPlayer(null);
          setIsPlaying(false);
          setNotice('当前歌曲没有可用的播放源');
        }
      } catch (error) {
        audioRef.current?.pause();
        setPlayer(null);
        setIsPlaying(false);
        setNotice(cleanErrorMessage(error, '应用内播放不可用，已停止本地客户端控制'));
      }
    } else {
      audioRef.current?.pause();
      setPlayer(null);
      setIsPlaying(false);
      openTrackWeb(track);
      setNotice('当前环境未接入应用内播放，已打开 QQ 音乐网页');
    }
    setTimeout(() => setNotice(''), 3000);
  }

  async function replace(trackId) {
    const excluded = new Set([...state.recommendations.map((track) => track.id), trackId]);
    const externalCandidates = mergeDiscoveryCandidates(await discoverExternalCandidates(8), state.discoveryCache ?? []);
    const replacement = (await enrichTracks(buildDailyRecommendations(1, excluded, externalCandidates)))[0];
    if (!replacement) return;
    const tracks = state.recommendations.map((track) => track.id === trackId ? replacement : track);
    commit({ ...state, recommendations: tracks });
    setNotice('已换成一首新的发现');
    setTimeout(() => setNotice(''), 2000);
  }

  async function addPlaylist() {
    if (!link.trim() || isSyncing) return;
    const input = link.trim();
    setIsSyncing(true);
    try {
      if (window.qqMusic?.importPublicPlaylist) {
        setNotice('正在读取 QQ 音乐公开歌单…');
        const playlist = await window.qqMusic.importPublicPlaylist(input);
        const next = { ...state, playlists: [...state.playlists.filter((item) => item.id !== playlist.id), playlist], synced: true };
        commit(next);
        setSourceId(playlist.id);
        setLink('');
        setNotice(`已同步「${playlist.name}」 · ${playlist.count} 首`);
      } else {
        const playlist = { id: `playlist-${Date.now()}`, name: '新导入歌单', description: '通过公开链接添加', source: 'QQ 音乐 · 待同步', count: 0, syncedAt: '等待同步', accent: '#8f7dca', url: input };
        const next = { ...state, playlists: [...state.playlists, playlist] };
        commit(next);
        setSourceId(playlist.id);
        setLink('');
        setNotice('开发浏览器暂不具备桌面请求能力；已保留待同步入口');
      }
    } catch (error) {
      setNotice(cleanErrorMessage(error, '歌单同步失败，请检查链接'));
    } finally {
      setIsSyncing(false);
    }
    setTimeout(() => setNotice(''), 3500);
  }

  function handleBackgroundUpload(event) {
    const file = event.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) {
      setNotice('请选择 PNG、JPG、WEBP 等图片文件');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const maxSide = 1920;
        const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        const background = canvas.toDataURL('image/jpeg', 0.82);
        const next = { ...state, settings: { ...(state.settings ?? {}), background } };
        commit(next);
        setNotice('背景已保存到本地设备');
        setTimeout(() => setNotice(''), 2200);
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
    event.target.value = '';
  }

  function removeBackground() {
    const next = { ...state, settings: { ...(state.settings ?? {}), background: '' } };
    commit(next);
    setNotice('已恢复默认背景');
    setTimeout(() => setNotice(''), 2200);
  }

  function resetWorkspace() {
    const next = { ...state, recommendations: [], history: [], feedback: {}, synced: state.synced };
    commit(next);
    setNotice('本地反馈与历史已清空');
    setTimeout(() => setNotice(''), 2200);
  }

  return (
    <div className="app-shell" style={state.settings?.background ? { backgroundImage: `linear-gradient(rgba(14,20,32,.87), rgba(14,20,32,.96)), url("${state.settings.background}")`, backgroundSize: 'cover', backgroundAttachment: 'fixed' } : undefined}>
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark"><img src={appIcon} alt="" /></div><div><span className="brand-name">DAILY</span><span className="brand-sub">DISCOVERY</span></div></div>
        <div className="profile-chip"><div className="avatar">H</div><div><strong>本地音乐空间</strong><span>只存储在这台电脑</span></div><ChevronDown size={15} /></div>
        <div className="nav-label">工作台</div>
        <nav className="main-nav">
          {NAV_ITEMS.map((item) => { const Icon = ICONS[item.icon]; return <button key={item.id} className={`nav-item ${view === item.id ? 'nav-active' : ''}`} onClick={() => setView(item.id)}><Icon size={18} /><span>{item.label}</span>{item.id === 'feedback' && feedbackCount > 0 ? <em>{feedbackCount}</em> : null}</button>; })}
        </nav>
        <div className="sidebar-bottom"><div className="nav-label">今日状态</div><div className="mini-status"><span className="green-orb" /><div><strong>本地模式正常</strong><span>数据不会离开设备</span></div></div><button className={`nav-item secondary-nav ${view === 'settings' ? 'nav-active' : ''}`} onClick={() => setView('settings')}><Settings2 size={18} /><span>设置</span></button><button className="nav-item secondary-nav" onClick={() => setNotice('帮助中心：先导入歌单，再生成今日推荐')}><CircleHelp size={18} /><span>使用帮助</span></button></div>
      </aside>

      <main className="main-content">
        <header className="topbar"><div className="breadcrumbs"><span>音乐空间</span><span className="crumb-separator">/</span><strong>{view === 'playlist-detail' ? detailPlaylist?.name ?? '歌单详情' : NAV_ITEMS.find((item) => item.id === view)?.label ?? '今日发现'}</strong></div><div className="topbar-actions"><div className="connection-state"><span className="green-orb" />{state.synced ? 'QQ 音乐歌单已同步' : '演示歌单已加载 · 适配器待接入'}</div><button className="icon-button quiet" onClick={() => setNotice('所有数据都保存在本地浏览器存储中')}><CircleHelp size={17} /></button></div></header>

        {view === 'discover' && <>
          <section className="hero-row"><div><div className="eyebrow"><span className="eyebrow-line" />{todayLabel()}</div><h1>今天，想听点<br /><span>不一样的。</span></h1><p className="hero-copy">从整张歌单画像出发，优先好听可靠，也保留恰到好处的新鲜感。</p></div><div className="hero-note"><div className="note-icon"><Sparkles size={18} /></div><div><span>推荐策略</span><strong>保险热门 70% · 个性探索 30%</strong><small>QQ 评论、Last.fm 热度与榜单记录联合验证</small></div></div></section>

          {usingRealPlaylist && (!credentialStatus.lastFmConfigured || !calibrationCompleted) ? <section className="setup-banner"><div className="setup-banner-icon"><KeyRound size={19} /></div><div><strong>{!credentialStatus.lastFmConfigured ? '还差一步才能启用高质量推荐' : '完成 30 首口味校准，推荐会更准'}</strong><span>{!credentialStatus.lastFmConfigured ? 'Last.fm 用于相似歌曲和听众热度验证；密钥只会加密保存在本机。' : `已完成 ${calibrationTracks.filter((track) => state.calibration?.[track.id]).length} / ${calibrationTracks.length} 首。`}</span></div><button className="secondary-button" onClick={() => setView('settings')}>前往设置 <ArrowUpRight size={14} /></button></section> : null}

          <section className="control-panel"><div className="control-heading"><div><span className="section-kicker">今日生成器</span><h2>告诉我今天想发现几首</h2></div><div className="source-select-wrap"><span>基于</span><button className="source-select" onClick={() => setShowSourceMenu(!showSourceMenu)}><div className="source-avatar" style={{ background: activePlaylist?.accent ?? '#f2b84b' }}><Music2 size={14} /></div><strong>{activePlaylist?.name ?? '未选择歌单'}</strong><ChevronDown size={15} /></button>{showSourceMenu && <div className="source-menu">{state.playlists.map((playlist) => <button key={playlist.id} onClick={() => { setSourceId(playlist.id); setShowSourceMenu(false); }}><span className="source-avatar" style={{ background: playlist.accent }}><Music2 size={13} /></span><span>{playlist.name}</span>{playlist.id === sourceId ? <Check size={15} /> : null}</button>)}</div>}</div></div><div className="preference-row"><PreferenceSelect label="心情" value={state.settings?.mood ?? 'auto'} onChange={(value) => updateSetting('mood', value)} options={[{ value: 'auto', label: '自动判断' }, { value: 'happy', label: '轻快开心' }, { value: 'calm', label: '安静放松' }, { value: 'sad', label: '伤感沉浸' }, { value: 'energetic', label: '高能提神' }]} /><PreferenceSelect label="语言" value={state.settings?.language ?? 'auto'} onChange={(value) => updateSetting('language', value)} options={[{ value: 'auto', label: '自动混合' }, { value: 'zh', label: '华语' }, { value: 'en', label: '英语' }, { value: 'ja-ko', label: '日语 / 韩语' }, { value: 'mixed', label: '不限语言' }]} /></div><div className="generator-row"><div className="quantity-input"><button onClick={() => setCount(Math.max(1, Number(count || 1) - 1))}>−</button><input value={count} onChange={(event) => setCount(Math.min(10, Number(event.target.value.replace(/\D/g, '').slice(0, 2)) || 1))} aria-label="推荐数量" /><span>首</span><button onClick={() => setCount(Math.min(10, Number(count || 1) + 1))}>+</button></div><div className="quick-counts"><span>快速选择</span>{[5, 10].map((value) => <button key={value} className={Number(count) === value ? 'selected-count' : ''} onClick={() => setCount(value)}>{value}</button>)}</div><button className="primary-button generate-button" onClick={generate} disabled={isGenerating}>{isGenerating ? <RefreshCw size={17} className="spin-icon" /> : <Sparkles size={17} />}{isGenerating ? '匹配中…' : '生成推荐'} {!isGenerating && <ArrowUpRight size={17} />}</button></div></section>

          <section className="metrics-row"><button className="metric-card metric-link" onClick={() => { setView('playlists'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}><div className="metric-icon gold"><LibraryBig size={17} /></div><div><span>已连接歌单</span><strong>{state.playlists.length} <small>个</small></strong></div><span className="metric-tail">查看歌单 <ArrowUpRight size={13} /></span></button><button className="metric-card metric-link" onClick={() => { setView('history'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}><div className="metric-icon purple"><SlidersHorizontal size={17} /></div><div><span>7 天曝光去重</span><strong>{recentExcluded.size} <small>首</small></strong></div><span className="metric-tail">查看历史 <ArrowUpRight size={13} /></span></button><button className="metric-card metric-link" onClick={() => { setView('feedback'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}><div className="metric-icon coral"><Heart size={17} /></div><div><span>累计反馈</span><strong>{feedbackCount} <small>次</small></strong></div><span className="metric-tail">查看反馈 <ArrowUpRight size={13} /></span></button></section>

          <section className="recommendation-section"><div className="section-header"><div><div className="section-kicker">为你挑选</div><h2>今日推荐 <span>{state.recommendations.length ? `· ${state.recommendations.length} 首` : ''}</span></h2></div>{state.recommendations.length ? <div className="result-tools"><StatusPill tone="green">已过滤重复与冷门</StatusPill><button className="text-button" onClick={generate}><RefreshCw size={15} />全部重抽</button></div> : null}</div>{state.recommendations.length === 0 ? <EmptyState onGenerate={generate} /> : <div className="track-grid">{state.recommendations.map((track) => <RecommendationCard key={track.id} track={track} feedback={state.feedback} onAction={action} onReplace={replace} onPlay={playTrack} />)}</div>}</section>
        </>}

        {view === 'playlists' && <section className="page-section"><div className="page-heading"><div><div className="section-kicker">来源管理</div><h1>我的歌单</h1><p>点击歌单进入详情，可查看、播放和管理歌曲。</p></div><StatusPill tone="green">本地优先</StatusPill></div><div className="import-panel"><div className="import-icon"><Link2 size={20} /></div><div><strong>添加 QQ 音乐公开歌单</strong><p>支持 QQ 音乐分享短链、网页长链和移动端链接。</p></div><div className="import-form"><input value={link} onChange={(event) => setLink(event.target.value)} placeholder="粘贴歌单链接…" disabled={isSyncing} /><button className="primary-button" onClick={addPlaylist} disabled={isSyncing}>{isSyncing ? <RefreshCw size={16} className="spin-icon" /> : <Plus size={16} />}{isSyncing ? '正在连接…' : '添加歌单'}</button></div></div><div className="playlist-grid">{state.playlists.map((playlist) => <div className="playlist-card" key={playlist.id} onClick={() => openPlaylist(playlist.id)}><div className="playlist-art" style={{ '--accent': playlist.accent }}><Music2 size={31} /><span>{String(playlist.count).padStart(3, '0')}</span></div><div className="playlist-card-body"><div className="playlist-card-title"><h3>{playlist.name}</h3><StatusPill tone={playlist.source.includes('已同步') ? 'green' : 'amber'}>{playlist.source.includes('已同步') ? '已同步' : '待同步'}</StatusPill></div><p>{playlist.description}</p><div className="playlist-detail"><span>{playlist.count} 首歌曲</span><span>同步于 {playlist.syncedAt}</span></div></div><button className="icon-button" onClick={(event) => { event.stopPropagation(); setSourceId(playlist.id); setView('discover'); }} title="设为推荐来源"><ArrowUpRight size={17} /></button></div>)}</div></section>}

        {view === 'playlist-detail' && detailPlaylist && <section className="page-section playlist-detail-page"><button className="back-button" onClick={() => setView('playlists')}><ArrowUpRight size={15} className="back-icon" />返回我的歌单</button><div className="playlist-detail-hero"><div className="playlist-large-art" style={{ '--accent': detailPlaylist.accent }}><Music2 size={55} /><span>{String(detailPlaylist.count).padStart(3, '0')}</span></div><div className="playlist-detail-copy">{editingPlaylistId === detailPlaylist.id ? <div className="rename-form"><input value={playlistNameDraft} onChange={(event) => setPlaylistNameDraft(event.target.value)} autoFocus /><button className="primary-button" onClick={() => savePlaylistName(detailPlaylist.id)}>保存</button><button className="text-button" onClick={() => setEditingPlaylistId(null)}>取消</button></div> : <><div className="section-kicker">歌单详情</div><h1>{detailPlaylist.name}</h1></>}<p>{detailPlaylist.description}</p><div className="playlist-detail-stats"><span>{detailPlaylist.tracks?.length ?? detailPlaylist.count} 首歌曲</span><span>同步于 {detailPlaylist.syncedAt}</span><StatusPill tone={detailPlaylist.source.includes('已同步') ? 'green' : 'amber'}>{detailPlaylist.source.includes('已同步') ? '已同步' : '演示 / 待同步'}</StatusPill></div><div className="playlist-detail-actions"><button className="primary-button" disabled={!detailTracks[0]} onClick={() => detailTracks[0] && playTrack(detailTracks[0])}><Play size={15} fill="currentColor" />播放第一首</button><button className="secondary-button" onClick={() => beginRename(detailPlaylist)}><Settings2 size={15} />重命名</button><button className="secondary-button" onClick={() => resyncPlaylist(detailPlaylist)}><RefreshCw size={15} />重新同步</button><button className="secondary-button danger-button" onClick={() => deletePlaylist(detailPlaylist.id)}><X size={15} />删除歌单</button></div></div></div><div className="detail-toolbar"><div><strong>歌曲列表</strong><span>{detailTracks.length} / {detailPlaylist.tracks?.length ?? detailPlaylist.count} 首</span></div><div className="detail-search"><Search size={15} /><input value={playlistSearch} onChange={(event) => setPlaylistSearch(event.target.value)} placeholder="搜索歌名、歌手或专辑" /></div></div><div className="add-track-row"><Plus size={16} /><input value={newTrackQuery} onChange={(event) => setNewTrackQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') addTrackToPlaylist(detailPlaylist); }} placeholder="输入歌名，添加到本地歌单…" /><button className="text-button" onClick={() => addTrackToPlaylist(detailPlaylist)}>添加歌曲</button></div>{detailTracks.length === 0 ? <div className="empty-state compact"><div className="empty-orbit"><LibraryBig size={30} /></div><h3>{detailPlaylist.tracks?.length ? '没有匹配的歌曲' : '这个歌单还没有歌曲数据'}</h3><p>{detailPlaylist.tracks?.length ? '换个搜索词试试。' : '请点击“重新同步”，或在桌面版中添加歌曲。'}</p></div> : <div className="track-table"><div className="track-table-head"><span>歌曲</span><span>专辑</span><span>时长</span><span>操作</span></div>{detailTracks.map((track) => <div className="track-table-row" key={track.id}><div className="table-track"><Cover track={track} small /><div><strong>{track.title}</strong><span>{track.artist || '未知歌手'}</span></div></div><span className="table-album">{track.album || '—'}</span><span className="table-duration">{track.duration || '—'}</span><div className="track-row-actions"><button className="action-button" title="在 QQ 音乐中播放" onClick={() => playTrack(track)}><Play size={14} fill="currentColor" /></button><button className="action-button remove-track-button" title="从本地歌单移除" onClick={() => removeTrackFromPlaylist(detailPlaylist.id, track.id)}><X size={15} /></button></div></div>)}</div>}</section>}

        {view === 'history' && <section className="page-section"><div className="page-heading"><div><div className="section-kicker">时间线</div><h1>推荐历史</h1><p>每一次生成，都是你音乐口味的一次快照。</p></div><button className="text-button danger-text" onClick={resetWorkspace}><X size={15} />清空历史与反馈</button></div>{state.history.length === 0 ? <div className="empty-state compact"><div className="empty-orbit"><HistoryIcon size={30} /></div><h3>还没有推荐历史</h3><p>生成第一份今日推荐后，它会出现在这里。</p></div> : <div className="history-list">{state.history.map((entry) => <div className="history-row" key={entry.id}><div className="history-date"><strong>{new Date(entry.createdAt).getDate()}</strong><span>{new Intl.DateTimeFormat('zh-CN', { month: 'short' }).format(new Date(entry.createdAt))}</span></div><div className="history-main"><div><strong>{entry.source}</strong><span>{entry.requested} 首请求 · 生成 {entry.tracks.length} 首</span></div><div className="history-covers">{entry.tracks.slice(0, 5).map((track) => <Cover key={track.id} track={track} small />)}{entry.tracks.length > 5 ? <span className="more-cover">+{entry.tracks.length - 5}</span> : null}</div></div><span className="history-time">{timeLabel(entry.createdAt)}</span></div>)}</div>}</section>}

        {view === 'feedback' && <section className="page-section"><div className="page-heading"><div><div className="section-kicker">长期偏好</div><h1>反馈中心</h1><p>喜欢和收藏永久加强偏好，不感兴趣会永久排除，已听过歌曲 90 天内不再出现。</p></div><StatusPill tone="purple">持续学习中</StatusPill></div><div className="feedback-summary"><div><strong>{feedbackCount}</strong><span>条反馈</span></div><div><strong>{likedCount}</strong><span>次喜欢 / 收藏</span></div><div><strong>{feedbackValues.filter((value) => value === 'dislike').length}</strong><span>首已排除</span></div></div><div className="feedback-table"><div className="feedback-table-head"><span>歌曲</span><span>歌手</span><span>你的反馈</span><span>操作</span></div>{Object.entries(state.feedback).length === 0 ? <div className="table-empty">还没有反馈。去今日发现里告诉系统你的口味吧。</div> : Object.entries(state.feedback).map(([trackId, entry]) => { const track = feedbackTracks.get(trackId); const value = feedbackValue(entry); if (!track) return null; return <div className="feedback-row" key={trackId}><div className="feedback-track"><Cover track={track} small /><strong>{track.title}</strong></div><span>{track.artist}</span><StatusPill tone={value === 'dislike' ? 'coral' : 'green'}>{({ like: '喜欢', favorite: '收藏', heard: '已听过', dislike: '不感兴趣' })[value]}</StatusPill><button className="text-button" onClick={() => { const next = { ...state, feedback: Object.fromEntries(Object.entries(state.feedback).filter(([id]) => id !== trackId)) }; commit(next); }}>撤销反馈</button></div>; })}</div></section>}

        {view === 'settings' && <section className="page-section settings-page">
          <div className="page-heading"><div><div className="section-kicker">推荐引擎</div><h1>设置</h1><p>配置候选来源、完成口味校准，并管理本地外观。</p></div><StatusPill tone={credentialStatus.encryptionAvailable ? 'green' : 'coral'}>{credentialStatus.encryptionAvailable ? 'Windows 加密存储' : '系统加密不可用'}</StatusPill></div>

          <div className="service-card settings-card">
            <div className="settings-card-icon"><KeyRound size={20} /></div>
            <div className="settings-card-copy">
              <div className="settings-title-row"><div><h2>推荐服务与 API 凭据</h2><p>Last.fm 负责相似歌曲和全球热度证据；AI 只提出候选，最终仍需通过 QQ 音乐精确匹配、版本过滤和多信号热度验证。</p></div><div className="service-statuses"><ServiceStatus configured={credentialStatus.lastFmConfigured}>Last.fm</ServiceStatus><ServiceStatus configured={credentialStatus.geminiConfigured}>Gemini</ServiceStatus><ServiceStatus configured={credentialStatus.openAiConfigured}>OpenAI</ServiceStatus></div></div>
              <div className="service-form-grid">
                <label className="wide-field"><span>OpenAI Compatible API Base URL</span><input value={state.settings?.openAiBaseUrl ?? 'https://api.openai.com/v1'} onChange={(event) => updateSetting('openAiBaseUrl', event.target.value)} placeholder="https://api.openai.com/v1" /><small>Groq: https://api.groq.com/openai/v1. This is an endpoint, not an API key.</small></label>
                <label><span>AI 候选来源</span><select value={state.settings?.aiProvider ?? 'gemini'} onChange={(event) => updateSetting('aiProvider', event.target.value)}><option value="gemini">Gemini</option><option value="openai">OpenAI</option><option value="off">仅使用 Last.fm</option></select></label>
                <label><span>Last.fm API Key（必填）</span><input type="password" value={credentialDraft.lastFmApiKey} onChange={(event) => setCredentialDraft({ ...credentialDraft, lastFmApiKey: event.target.value })} placeholder={credentialStatus.lastFmConfigured ? '已配置；留空则保持不变' : '粘贴 Last.fm API Key'} /></label>
                <label><span>Gemini API Key</span><input type="password" value={credentialDraft.geminiApiKey} onChange={(event) => setCredentialDraft({ ...credentialDraft, geminiApiKey: event.target.value })} placeholder={credentialStatus.geminiConfigured ? '已配置；留空则保持不变' : '选择 Gemini 时填写'} /></label>
                <label><span>OpenAI API Key</span><input type="password" value={credentialDraft.openAiApiKey} onChange={(event) => setCredentialDraft({ ...credentialDraft, openAiApiKey: event.target.value })} placeholder={credentialStatus.openAiConfigured ? '已配置；留空则保持不变' : '选择 OpenAI 时填写'} /></label>
                <label><span>Gemini 模型</span><input value={state.settings?.geminiModel ?? 'gemini-2.5-flash'} onChange={(event) => updateSetting('geminiModel', event.target.value)} /></label>
                <label><span>OpenAI 模型</span><input value={state.settings?.openAiModel ?? 'gpt-5-mini'} onChange={(event) => updateSetting('openAiModel', event.target.value)} /></label>
              </div>
              <div className="settings-actions"><button className="primary-button" onClick={saveCredentials} disabled={isSavingCredentials || !credentialStatus.encryptionAvailable}>{isSavingCredentials ? <RefreshCw size={16} className="spin-icon" /> : <KeyRound size={16} />}{isSavingCredentials ? '保存中…' : '加密保存凭据'}</button><small>密钥不会显示、写入 Git 仓库或进入推荐历史。</small></div>
            </div>
          </div>

          <div className="calibration-card settings-card">
            <div className="settings-card-icon"><SlidersHorizontal size={20} /></div>
            <div className="settings-card-copy">
              <div className="settings-title-row"><div><h2>30 首口味校准</h2><p>从当前歌单均匀抽样。喜欢会增强对应画像，不喜欢会降低歌手与风格权重，一般不会改变偏好。</p></div><StatusPill tone={calibrationCompleted ? 'green' : 'purple'}>{calibrationTracks.filter((track) => state.calibration?.[track.id]).length} / {calibrationTracks.length}</StatusPill></div>
              {!usingRealPlaylist ? <div className="table-empty">请先导入并选择真实 QQ 音乐歌单。</div> : <div className="calibration-list">{calibrationTracks.map((track) => <div className="calibration-row" key={track.id}><div className="calibration-track"><Cover track={track} small /><div><strong>{track.title}</strong><span>{track.artist}</span></div></div><div className="calibration-actions"><button className={state.calibration?.[track.id] === 'like' ? 'selected' : ''} onClick={() => updateCalibration(track.id, 'like')}><ThumbsUp size={14} />喜欢</button><button className={state.calibration?.[track.id] === 'neutral' ? 'selected' : ''} onClick={() => updateCalibration(track.id, 'neutral')}>一般</button><button className={state.calibration?.[track.id] === 'dislike' ? 'selected dislike' : ''} onClick={() => updateCalibration(track.id, 'dislike')}><Ban size={14} />不喜欢</button></div></div>)}</div>}
              {usingRealPlaylist ? <div className="settings-actions"><button className="text-button" onClick={() => commit({ ...state, calibration: {} })}><RefreshCw size={15} />重新校准</button><small>“一般”只计为已完成，不影响口味权重。</small></div> : null}
            </div>
          </div>

          <div className="settings-grid appearance-grid"><div className="settings-card"><div className="settings-card-icon"><ImagePlus size={20} /></div><div className="settings-card-copy"><h2>自定义背景</h2><p>上传本地图片作为应用背景。图片会压缩后保存在本机，不会上传到网络。</p><div className="settings-actions"><label className="primary-button upload-button"><ImagePlus size={16} />上传图片<input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleBackgroundUpload} /></label>{state.settings?.background ? <button className="text-button" onClick={removeBackground}><X size={15} />恢复默认</button> : null}</div></div></div><div className="background-preview" style={state.settings?.background ? { backgroundImage: `url("${state.settings.background}")` } : undefined}>{state.settings?.background ? <span>当前背景</span> : <><Music2 size={28} /><span>默认背景</span></>}</div></div>
          <div className="settings-card privacy-card"><div className="settings-card-icon green-icon"><Check size={20} /></div><div className="settings-card-copy"><h2>数据边界</h2><p>歌单、反馈、校准、推荐历史和背景保存在本机。生成推荐时，歌曲画像会发送给你主动配置的 Last.fm、Gemini 或 OpenAI 服务；API 密钥由 Windows 加密存储。</p></div></div>
        </section>}

        <footer className="app-footer"><span><span className="green-orb" />本地模式 · 数据存储在此设备</span><span>Daily Discovery v{packageInfo.version}</span></footer>
      </main>
      <audio ref={audioRef} className="native-audio" onTimeUpdate={(event) => setPlaybackTime(event.currentTarget.currentTime)} onLoadedMetadata={(event) => setPlaybackDuration(event.currentTarget.duration || 0)} onEnded={() => setIsPlaying(false)} />
      <PlaybackBar player={player} isPlaying={isPlaying} currentTime={playbackTime} duration={playbackDuration} onToggle={togglePlayback} onSeek={seekPlayback} onOpenWeb={() => openTrackWeb(player?.track)} onClose={() => { audioRef.current?.pause(); setPlayer(null); setIsPlaying(false); }} />
      {notice ? <div className={`toast ${isErrorNotice(notice) ? 'toast-error' : ''}`} role={isErrorNotice(notice) ? 'alert' : 'status'}>{isErrorNotice(notice) ? <AlertCircle size={16} /> : <Check size={16} />}{notice}</div> : null}
    </div>
  );
}

export default App;
