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
  LibraryBig,
  Link2,
  Music2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  SkipForward,
  SlidersHorizontal,
  Sparkles,
  ThumbsUp,
  WandSparkles,
  X,
} from 'lucide-react';
import { CANDIDATES, NAV_ITEMS } from './data';
import { buildRecommendations, hasRealPlaylistTracks } from './recommendation';
import { daysSince, loadState, saveState } from './storage';

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
  const selected = feedback?.[track.id];
  const canPlayInApp = Boolean(track.playbackUrl);
  return (
    <article className={`track-card ${selected ? 'has-feedback' : ''}`}>
      <div className="card-topline"><span className="match-label">{track.tag}</span><span className="match-score">{Math.round(72 + track.popularity / 10)}% 匹配</span></div>
      <Cover track={track} onClick={() => onPlay(track)} />
      <div className="track-info">
        <div className="track-heading"><div><h3>{track.title}</h3><p>{track.artist}</p></div><button className="icon-button" title="打开 QQ 音乐网页" onClick={() => window.open(track.url || `https://y.qq.com/n/ryqq/search?w=${encodeURIComponent(`${track.title} ${track.artist}`)}`, '_blank')}><ExternalLink size={16} /></button></div>
        <div className="track-meta"><span>{track.album}</span><span>{track.genre}</span></div>
        <div className="card-actions">
          <button className="play-button" onClick={() => onPlay(track)}>{canPlayInApp ? <Play size={13} fill="currentColor" /> : <ExternalLink size={13} />}{canPlayInApp ? '播放' : '打开 QQ 音乐'}</button>
          <button className={`action-button ${selected === 'like' ? 'active-like' : ''}`} title="喜欢" onClick={() => onAction(track.id, 'like')}><ThumbsUp size={15} /></button>
          <button className={`action-button ${selected === 'favorite' ? 'active-save' : ''}`} title="收藏" onClick={() => onAction(track.id, 'favorite')}><Bookmark size={15} /></button>
          <button className={`action-button ${selected === 'heard' ? 'active-heard' : ''}`} title="已听过" onClick={() => onAction(track.id, 'heard')}><Check size={15} /></button>
          <button className={`action-button ${selected === 'skip' ? 'active-skip' : ''}`} title="跳过" onClick={() => onAction(track.id, 'skip')}><SkipForward size={15} /></button>
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
  const audioRef = useRef(null);

  const activePlaylist = state.playlists.find((playlist) => playlist.id === sourceId) ?? state.playlists[0];
  const usingRealPlaylist = hasRealPlaylistTracks(activePlaylist);
  const detailPlaylist = state.playlists.find((playlist) => playlist.id === selectedPlaylistId);
  const detailTracks = (detailPlaylist?.tracks ?? []).filter((track) => `${track.title} ${track.artist} ${track.album}`.toLowerCase().includes(playlistSearch.trim().toLowerCase()));
  const feedbackValues = Object.values(state.feedback);
  const feedbackCount = feedbackValues.length;
  const likedCount = feedbackValues.filter((value) => value === 'like' || value === 'favorite').length;
  const feedbackTracks = useMemo(() => {
    const tracks = new Map();
    [...state.playlists.flatMap((playlist) => playlist.tracks ?? []), ...state.history.flatMap((entry) => entry.tracks ?? []), ...CANDIDATES]
      .forEach((track) => tracks.set(track.id, track));
    return tracks;
  }, [state.playlists, state.history]);

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
    const ids = new Set();
    state.history.forEach((entry) => {
      if (daysSince(entry.createdAt) < 90) (entry.trackIds ?? entry.tracks?.map((track) => track.id) ?? []).forEach((id) => ids.add(id));
    });
    return ids;
  }, [state.history]);

  function commit(next) {
    setState(next);
    saveState(next);
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
    const rejected = new Set(Object.entries(state.feedback).filter(([, value]) => value === 'dislike').map(([id]) => id));
    const hasExternalCandidates = externalCandidates.length > 0;
    return buildRecommendations({
      playlist: hasExternalCandidates ? { tracks: [] } : (usingRealPlaylist ? { tracks: [] } : activePlaylist),
      fallbackCandidates: hasExternalCandidates ? [...externalCandidates, ...CANDIDATES] : CANDIDATES,
      amount,
      excluded,
      rejected,
      blockedTracks: usingRealPlaylist ? activePlaylist.tracks : [],
      sourceType: hasExternalCandidates ? 'discovery' : 'demo',
    });
  }

  async function discoverExternalCandidates(amount) {
    if (!usingRealPlaylist || !window.qqMusic?.discoverTracks) return [];
    const seeds = activePlaylist.tracks.filter((track) => track.artist && track.title).slice(0, 12);
    if (seeds.length === 0) return [];
    try {
      return await window.qqMusic.discoverTracks({
        seeds,
        excludedTracks: activePlaylist.tracks,
        limit: Math.max(60, amount * 8),
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
        return resolved ? { ...track, ...resolved } : track;
      } catch {
        return track;
      }
    }));
    return enriched;
  }

  async function generate() {
    const requested = Math.max(1, Math.min(40, Number(count) || 1));
    setIsGenerating(true);
    setNotice(usingRealPlaylist ? '正在寻找歌单之外的相关歌曲…' : '正在匹配 QQ 音乐封面与播放信息…');
    const externalCandidates = await discoverExternalCandidates(requested);
    const tracks = await enrichTracks(buildDailyRecommendations(requested, recentExcluded, externalCandidates));
    const entry = { id: `history-${Date.now()}`, createdAt: new Date().toISOString(), source: activePlaylist?.name ?? '常听收藏', requested, trackIds: tracks.map((track) => track.id), tracks };
    const next = { ...state, recommendations: tracks, history: [entry, ...state.history].slice(0, 50) };
    commit(next);
    setIsGenerating(false);
    const resultLabel = tracks.length < requested
      ? `可用歌曲不足，已生成 ${tracks.length} 首（目标 ${requested} 首）`
      : `${externalCandidates.length ? '已基于歌单画像探索新歌' : usingRealPlaylist ? '未找到足够歌单外歌曲，使用备用探索池' : '当前使用演示候选生成'} ${tracks.length} 首今日推荐`;
    setNotice(resultLabel);
    setTimeout(() => setNotice(''), 2600);
  }

  function action(trackId, value) {
    const next = { ...state, feedback: { ...state.feedback, [trackId]: value } };
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
    const externalCandidates = await discoverExternalCandidates(8);
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
        <div className="brand"><div className="brand-mark"><Sparkles size={18} /></div><div><span className="brand-name">DAILY</span><span className="brand-sub">DISCOVERY</span></div></div>
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
          <section className="hero-row"><div><div className="eyebrow"><span className="eyebrow-line" />{todayLabel()}</div><h1>今天，想听点<br /><span>不一样的。</span></h1><p className="hero-copy">从你的常听收藏出发，留一点熟悉，也留一点意外。</p></div><div className="hero-note"><div className="note-icon"><Sparkles size={18} /></div><div><span>推荐策略</span><strong>熟悉 50% · 探索 50%</strong><small>曲风与情绪优先，过滤过冷歌曲</small></div></div></section>

          <section className="control-panel"><div className="control-heading"><div><span className="section-kicker">今日生成器</span><h2>告诉我今天想发现几首</h2></div><div className="source-select-wrap"><span>基于</span><button className="source-select" onClick={() => setShowSourceMenu(!showSourceMenu)}><div className="source-avatar" style={{ background: activePlaylist?.accent ?? '#f2b84b' }}><Music2 size={14} /></div><strong>{activePlaylist?.name ?? '未选择歌单'}</strong><ChevronDown size={15} /></button>{showSourceMenu && <div className="source-menu">{state.playlists.map((playlist) => <button key={playlist.id} onClick={() => { setSourceId(playlist.id); setShowSourceMenu(false); }}><span className="source-avatar" style={{ background: playlist.accent }}><Music2 size={13} /></span><span>{playlist.name}</span>{playlist.id === sourceId ? <Check size={15} /> : null}</button>)}</div>}</div></div><div className="generator-row"><div className="quantity-input"><button onClick={() => setCount(Math.max(1, count - 1))}>−</button><input value={count} onChange={(event) => setCount(event.target.value.replace(/\D/g, '').slice(0, 2))} aria-label="推荐数量" /><span>首</span><button onClick={() => setCount(Math.min(40, Number(count || 1) + 1))}>+</button></div><div className="quick-counts"><span>快速选择</span>{[5, 10, 20, 30].map((value) => <button key={value} className={Number(count) === value ? 'selected-count' : ''} onClick={() => setCount(value)}>{value}</button>)}</div><button className="primary-button generate-button" onClick={generate} disabled={isGenerating}>{isGenerating ? <RefreshCw size={17} className="spin-icon" /> : <Sparkles size={17} />}{isGenerating ? '匹配中…' : '生成推荐'} {!isGenerating && <ArrowUpRight size={17} />}</button></div></section>

          <section className="metrics-row"><button className="metric-card metric-link" onClick={() => { setView('playlists'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}><div className="metric-icon gold"><LibraryBig size={17} /></div><div><span>已连接歌单</span><strong>{state.playlists.length} <small>个</small></strong></div><span className="metric-tail">查看歌单 <ArrowUpRight size={13} /></span></button><button className="metric-card metric-link" onClick={() => { setView('history'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}><div className="metric-icon purple"><SlidersHorizontal size={17} /></div><div><span>90 天去重</span><strong>{recentExcluded.size} <small>首</small></strong></div><span className="metric-tail">查看历史 <ArrowUpRight size={13} /></span></button><button className="metric-card metric-link" onClick={() => { setView('feedback'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}><div className="metric-icon coral"><Heart size={17} /></div><div><span>累计反馈</span><strong>{feedbackCount} <small>次</small></strong></div><span className="metric-tail">查看反馈 <ArrowUpRight size={13} /></span></button></section>

          <section className="recommendation-section"><div className="section-header"><div><div className="section-kicker">为你挑选</div><h2>今日推荐 <span>{state.recommendations.length ? `· ${state.recommendations.length} 首` : ''}</span></h2></div>{state.recommendations.length ? <div className="result-tools"><StatusPill tone="green">已过滤重复与冷门</StatusPill><button className="text-button" onClick={generate}><RefreshCw size={15} />全部重抽</button></div> : null}</div>{state.recommendations.length === 0 ? <EmptyState onGenerate={generate} /> : <div className="track-grid">{state.recommendations.map((track) => <RecommendationCard key={track.id} track={track} feedback={state.feedback} onAction={action} onReplace={replace} onPlay={playTrack} />)}</div>}</section>
        </>}

        {view === 'playlists' && <section className="page-section"><div className="page-heading"><div><div className="section-kicker">来源管理</div><h1>我的歌单</h1><p>点击歌单进入详情，可查看、播放和管理歌曲。</p></div><StatusPill tone="green">本地优先</StatusPill></div><div className="import-panel"><div className="import-icon"><Link2 size={20} /></div><div><strong>添加 QQ 音乐公开歌单</strong><p>支持 QQ 音乐分享短链、网页长链和移动端链接。</p></div><div className="import-form"><input value={link} onChange={(event) => setLink(event.target.value)} placeholder="粘贴歌单链接…" disabled={isSyncing} /><button className="primary-button" onClick={addPlaylist} disabled={isSyncing}>{isSyncing ? <RefreshCw size={16} className="spin-icon" /> : <Plus size={16} />}{isSyncing ? '正在连接…' : '添加歌单'}</button></div></div><div className="playlist-grid">{state.playlists.map((playlist) => <div className="playlist-card" key={playlist.id} onClick={() => openPlaylist(playlist.id)}><div className="playlist-art" style={{ '--accent': playlist.accent }}><Music2 size={31} /><span>{String(playlist.count).padStart(3, '0')}</span></div><div className="playlist-card-body"><div className="playlist-card-title"><h3>{playlist.name}</h3><StatusPill tone={playlist.source.includes('已同步') ? 'green' : 'amber'}>{playlist.source.includes('已同步') ? '已同步' : '待同步'}</StatusPill></div><p>{playlist.description}</p><div className="playlist-detail"><span>{playlist.count} 首歌曲</span><span>同步于 {playlist.syncedAt}</span></div></div><button className="icon-button" onClick={(event) => { event.stopPropagation(); setSourceId(playlist.id); setView('discover'); }} title="设为推荐来源"><ArrowUpRight size={17} /></button></div>)}</div></section>}

        {view === 'playlist-detail' && detailPlaylist && <section className="page-section playlist-detail-page"><button className="back-button" onClick={() => setView('playlists')}><ArrowUpRight size={15} className="back-icon" />返回我的歌单</button><div className="playlist-detail-hero"><div className="playlist-large-art" style={{ '--accent': detailPlaylist.accent }}><Music2 size={55} /><span>{String(detailPlaylist.count).padStart(3, '0')}</span></div><div className="playlist-detail-copy">{editingPlaylistId === detailPlaylist.id ? <div className="rename-form"><input value={playlistNameDraft} onChange={(event) => setPlaylistNameDraft(event.target.value)} autoFocus /><button className="primary-button" onClick={() => savePlaylistName(detailPlaylist.id)}>保存</button><button className="text-button" onClick={() => setEditingPlaylistId(null)}>取消</button></div> : <><div className="section-kicker">歌单详情</div><h1>{detailPlaylist.name}</h1></>}<p>{detailPlaylist.description}</p><div className="playlist-detail-stats"><span>{detailPlaylist.tracks?.length ?? detailPlaylist.count} 首歌曲</span><span>同步于 {detailPlaylist.syncedAt}</span><StatusPill tone={detailPlaylist.source.includes('已同步') ? 'green' : 'amber'}>{detailPlaylist.source.includes('已同步') ? '已同步' : '演示 / 待同步'}</StatusPill></div><div className="playlist-detail-actions"><button className="primary-button" disabled={!detailTracks[0]} onClick={() => detailTracks[0] && playTrack(detailTracks[0])}><Play size={15} fill="currentColor" />播放第一首</button><button className="secondary-button" onClick={() => beginRename(detailPlaylist)}><Settings2 size={15} />重命名</button><button className="secondary-button" onClick={() => resyncPlaylist(detailPlaylist)}><RefreshCw size={15} />重新同步</button><button className="secondary-button danger-button" onClick={() => deletePlaylist(detailPlaylist.id)}><X size={15} />删除歌单</button></div></div></div><div className="detail-toolbar"><div><strong>歌曲列表</strong><span>{detailTracks.length} / {detailPlaylist.tracks?.length ?? detailPlaylist.count} 首</span></div><div className="detail-search"><Search size={15} /><input value={playlistSearch} onChange={(event) => setPlaylistSearch(event.target.value)} placeholder="搜索歌名、歌手或专辑" /></div></div><div className="add-track-row"><Plus size={16} /><input value={newTrackQuery} onChange={(event) => setNewTrackQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') addTrackToPlaylist(detailPlaylist); }} placeholder="输入歌名，添加到本地歌单…" /><button className="text-button" onClick={() => addTrackToPlaylist(detailPlaylist)}>添加歌曲</button></div>{detailTracks.length === 0 ? <div className="empty-state compact"><div className="empty-orbit"><LibraryBig size={30} /></div><h3>{detailPlaylist.tracks?.length ? '没有匹配的歌曲' : '这个歌单还没有歌曲数据'}</h3><p>{detailPlaylist.tracks?.length ? '换个搜索词试试。' : '请点击“重新同步”，或在桌面版中添加歌曲。'}</p></div> : <div className="track-table"><div className="track-table-head"><span>歌曲</span><span>专辑</span><span>时长</span><span>操作</span></div>{detailTracks.map((track) => <div className="track-table-row" key={track.id}><div className="table-track"><Cover track={track} small /><div><strong>{track.title}</strong><span>{track.artist || '未知歌手'}</span></div></div><span className="table-album">{track.album || '—'}</span><span className="table-duration">{track.duration || '—'}</span><div className="track-row-actions"><button className="action-button" title="在 QQ 音乐中播放" onClick={() => playTrack(track)}><Play size={14} fill="currentColor" /></button><button className="action-button remove-track-button" title="从本地歌单移除" onClick={() => removeTrackFromPlaylist(detailPlaylist.id, track.id)}><X size={15} /></button></div></div>)}</div>}</section>}

        {view === 'history' && <section className="page-section"><div className="page-heading"><div><div className="section-kicker">时间线</div><h1>推荐历史</h1><p>每一次生成，都是你音乐口味的一次快照。</p></div><button className="text-button danger-text" onClick={resetWorkspace}><X size={15} />清空历史与反馈</button></div>{state.history.length === 0 ? <div className="empty-state compact"><div className="empty-orbit"><HistoryIcon size={30} /></div><h3>还没有推荐历史</h3><p>生成第一份今日推荐后，它会出现在这里。</p></div> : <div className="history-list">{state.history.map((entry) => <div className="history-row" key={entry.id}><div className="history-date"><strong>{new Date(entry.createdAt).getDate()}</strong><span>{new Intl.DateTimeFormat('zh-CN', { month: 'short' }).format(new Date(entry.createdAt))}</span></div><div className="history-main"><div><strong>{entry.source}</strong><span>{entry.requested} 首请求 · 生成 {entry.tracks.length} 首</span></div><div className="history-covers">{entry.tracks.slice(0, 5).map((track) => <Cover key={track.id} track={track} small />)}{entry.tracks.length > 5 ? <span className="more-cover">+{entry.tracks.length - 5}</span> : null}</div></div><span className="history-time">{timeLabel(entry.createdAt)}</span></div>)}</div>}</section>}

        {view === 'feedback' && <section className="page-section"><div className="page-heading"><div><div className="section-kicker">长期偏好</div><h1>反馈中心</h1><p>你的每一次选择，都会影响以后所有推荐。</p></div><StatusPill tone="purple">持续学习中</StatusPill></div><div className="feedback-summary"><div><strong>{feedbackCount}</strong><span>条反馈</span></div><div><strong>{likedCount}</strong><span>次喜欢 / 收藏</span></div><div><strong>{Object.values(state.feedback).filter((value) => value === 'dislike').length}</strong><span>首已排除</span></div></div><div className="feedback-table"><div className="feedback-table-head"><span>歌曲</span><span>歌手</span><span>你的反馈</span><span>操作</span></div>{Object.entries(state.feedback).length === 0 ? <div className="table-empty">还没有反馈。去今日发现里告诉系统你的口味吧。</div> : Object.entries(state.feedback).map(([trackId, value]) => { const track = feedbackTracks.get(trackId); if (!track) return null; return <div className="feedback-row" key={trackId}><div className="feedback-track"><Cover track={track} small /><strong>{track.title}</strong></div><span>{track.artist}</span><StatusPill tone={value === 'dislike' ? 'coral' : 'green'}>{({ like: '喜欢', favorite: '收藏', heard: '已听过', skip: '跳过', dislike: '不感兴趣' })[value]}</StatusPill><button className="text-button" onClick={() => { const next = { ...state, feedback: Object.fromEntries(Object.entries(state.feedback).filter(([id]) => id !== trackId)) }; commit(next); }}>撤销反馈</button></div>; })}</div></section>}

        {view === 'settings' && <section className="page-section"><div className="page-heading"><div><div className="section-kicker">个性化</div><h1>设置</h1><p>把音乐空间调整成你喜欢的样子。</p></div><StatusPill tone="green">全部本地保存</StatusPill></div><div className="settings-grid"><div className="settings-card"><div className="settings-card-icon"><ImagePlus size={20} /></div><div className="settings-card-copy"><h2>自定义背景</h2><p>上传本地图片作为应用背景。图片会压缩后保存在本机，不会上传到网络。</p><div className="settings-actions"><label className="primary-button upload-button"><ImagePlus size={16} />上传图片<input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleBackgroundUpload} /></label>{state.settings?.background ? <button className="text-button" onClick={removeBackground}><X size={15} />恢复默认</button> : null}</div></div></div><div className="background-preview" style={state.settings?.background ? { backgroundImage: `url("${state.settings.background}")` } : undefined}>{state.settings?.background ? <span>当前背景</span> : <><Music2 size={28} /><span>默认背景</span></>}</div></div><div className="settings-card privacy-card"><div className="settings-card-icon green-icon"><Check size={20} /></div><div className="settings-card-copy"><h2>本地优先</h2><p>推荐历史、反馈和背景图片均保存在这台电脑。QQ 音乐请求只在导入或播放时发起。</p></div></div></section>}

        <footer className="app-footer"><span><span className="green-orb" />本地模式 · 数据存储在此设备</span><span>Daily Discovery v0.1</span></footer>
      </main>
      <audio ref={audioRef} className="native-audio" onTimeUpdate={(event) => setPlaybackTime(event.currentTarget.currentTime)} onLoadedMetadata={(event) => setPlaybackDuration(event.currentTarget.duration || 0)} onEnded={() => setIsPlaying(false)} />
      <PlaybackBar player={player} isPlaying={isPlaying} currentTime={playbackTime} duration={playbackDuration} onToggle={togglePlayback} onSeek={seekPlayback} onOpenWeb={() => openTrackWeb(player?.track)} onClose={() => { audioRef.current?.pause(); setPlayer(null); setIsPlaying(false); }} />
      {notice ? <div className={`toast ${isErrorNotice(notice) ? 'toast-error' : ''}`} role={isErrorNotice(notice) ? 'alert' : 'status'}>{isErrorNotice(notice) ? <AlertCircle size={16} /> : <Check size={16} />}{notice}</div> : null}
    </div>
  );
}

export default App;
