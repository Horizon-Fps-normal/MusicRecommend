# Daily Discovery

Windows 本地优先的每日音乐发现应用：以 QQ 音乐歌单作为兴趣种子，输入数量后生成一组“熟悉 50% / 探索 50%”的推荐，并记录长期反馈。

## 当前状态

- 已完成：深色音乐工作台 UI、数量生成、歌单入口、推荐卡片、QQ 封面解析、逐首换歌、喜欢/收藏/已听过/跳过/不感兴趣、90 天推荐去重、歌手每日一首、历史记录、本地存储。
- 已完成：移除不稳定的 QQ 音乐桌面客户端窗口自动化与 `qqmusic://` 假成功流程；播放入口改为“合法音频地址进入应用内播放器，否则打开 QQ 音乐网页”。
- 已完成：应用内播放器支持播放/暂停、进度拖动、关闭和跳转 QQ 音乐网页。当前 QQ 公开搜索适配器不会返回授权音频地址，因此默认使用网页备用。
- 已完成：设置页支持上传 PNG/JPG/WEBP 本地图片作为背景，压缩后只保存在本机。
- 已完成：Vite 构建和 Electron 桌面壳加载验证。
- 待接入：真实 QQ 音乐登录会话读取、私有歌单自动同步，以及基于真实歌单内容的推荐候选检索。

当前首页仍使用演示歌单与演示候选数据；桌面版生成时会尝试为候选歌曲解析真实 QQ songmid/专辑封面。界面明确标记为“演示数据”，不代表已读取用户的真实 QQ 音乐账号。

## 运行

```powershell
npm.cmd install
npm.cmd run dev
```

桌面壳：

```powershell
npm.cmd run desktop
```

## 接入边界

`src/qqMusicAdapter.js` 已预留公开歌单导入适配器：

- `extractPlaylistId(input)`：从公开链接识别歌单 ID。
- `createQQMusicAdapter().importPublicPlaylist(input)`：请求公开歌单并归一化歌曲字段。

QQ 音乐公开搜索和歌单接口只用于元数据，不负责控制本地 QQ 音乐客户端。应用内播放需要接入具备版权和用户授权的正式播放服务，并由 Electron 主进程返回 HTTPS 音频地址；未配置时必须使用网页备用，不能读取用户 Cookie 或模拟桌面点击。

## Recommendation behavior

- An imported playlist is treated as a taste profile, not as the recommendation pool. Discovery combines neighboring songs from playlist artists with multiple QQ public chart categories, so new artists can be recommended.
- Each generation keeps a familiar lane from playlist artists while reserving most slots for new artists and chart discovery; multi-page artist searches and rotating result pages keep the long-term pool larger.
- Candidate quality filtering removes common live, DJ, remix, sped-up, slowed, preview, snippet, ringtone, accompaniment, and very short versions before ranking.
- Ranking uses normalized genre family, mood family, estimated energy/rhythm level, popularity, chart source, artist novelty, feedback, and recent-history exclusion. QQ's public song search does not expose reliable acoustic features, so rhythm and mood are metadata-based estimates rather than audio analysis.
- Existing playlist tracks are excluded by QQ songmid and by normalized title/artist. Daily generation keeps at most one song per artist when enough distinct artists are available.
- Daily generation applies 90-day history exclusion, dislike exclusion, popularity filtering when metadata exists, and one track per artist.
- The artist rule relaxes only when the source cannot provide enough distinct artists, and the UI reports when the requested quantity cannot be reached.

## Windows packaging

```powershell
npm.cmd install
npm.cmd run package:win
```

The portable executable is written to `release-portable/Daily-Discovery-0.5.0-portable.exe`. An NSIS installer can be attempted with `npm.cmd run package:win:installer`; on some Windows machines, antivirus or controlled-folder protection may block the final installer file even though the unpacked application has been built successfully.
