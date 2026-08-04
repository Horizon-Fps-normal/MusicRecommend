# Daily Discovery

<img src="assets/daily-discovery-icon-512.png" width="112" alt="Daily Discovery 应用图标" />

Windows 本地优先的每日音乐发现应用：以 QQ 音乐公开歌单作为兴趣画像，结合 Last.fm 相似收听、可选 AI 候选和 QQ 音乐热度验证，生成歌单外推荐并持续学习反馈。

## 当前状态

- 已完成：深色音乐工作台 UI、1–10 首数量生成、心情/语言偏好、歌单入口、推荐卡片、QQ 封面解析、逐首换歌、喜欢/收藏/已听过/不感兴趣、7 天曝光去重、历史记录和本地缓存。
- 已完成：移除不稳定的 QQ 音乐桌面客户端窗口自动化与 `qqmusic://` 假成功流程；播放入口改为“合法音频地址进入应用内播放器，否则打开 QQ 音乐网页”。
- 已完成：应用内播放器支持播放/暂停、进度拖动、关闭和跳转 QQ 音乐网页。当前 QQ 公开搜索适配器不会返回授权音频地址，因此默认使用网页备用。
- 已完成：设置页支持上传 PNG/JPG/WEBP 本地图片作为背景，压缩后只保存在本机。
- 已完成：Vite 构建和 Electron 桌面壳加载验证。
- 已完成：公开歌单导入、30 首口味校准、Last.fm 相似歌曲与热度数据、Gemini/OpenAI 结构化候选、QQ 精确解析、动态评论门槛、多信号热度核验、同名去重和严格版本过滤。
- 已完成：API 密钥通过 Electron `safeStorage` 使用 Windows 系统加密，仅保存在本机，不写入仓库或推荐历史。
- 待接入：真实 QQ 音乐登录会话读取、私有歌单自动同步和官方授权播放服务。

未导入公开歌单时首页使用演示数据。导入后请在设置中填写 Last.fm API Key；Gemini 或 OpenAI 为可选候选来源。外部服务不可用时只使用已经通过验证的本地缓存，不降低质量门槛凑数。

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

## API 申请与配置

### 1. Last.fm API Key

Last.fm 用于获取相似歌曲、听众数、播放数和标签。申请步骤如下：

1. 注册并登录 [Last.fm](https://www.last.fm/)。如果页面提示验证邮箱，请先完成验证。
2. 打开官方 [Create an API account](https://www.last.fm/api/account/create) 页面。
3. 填写应用名称，例如 `Daily Discovery`；描述可填写“个人本地音乐推荐工具”。Homepage 和 Callback URL 对本地版本不是必需项，可留空或填写项目 GitHub 地址。
4. 提交后复制页面中的 **API Key**。不要复制 Shared Secret，也不要把 API Key 提交到 GitHub。
5. 打开软件「设置 → 推荐服务与 API 凭据」，把 API Key 粘贴到 `Last.fm API Key`，点击「加密保存凭据」。

### 2. Gemini API Key

Gemini 是可选的候选扩展来源；推荐最终仍会经过 QQ 音乐匹配和热度过滤。申请步骤如下：

1. 登录 Google 账号，打开 [Google AI Studio API keys](https://aistudio.google.com/app/apikey)。
2. 点击创建 API key；如果页面要求选择项目，创建或选择一个用于本地应用的 Google Cloud 项目。
3. 复制生成的 Gemini API key。不要把密钥写入 README、截图、源代码或 Git 提交。
4. 在软件设置中选择 `Gemini`，将密钥粘贴到 `Gemini API Key`；模型默认使用 `gemini-2.5-flash`，然后点击「加密保存凭据」。

### 3. OpenAI 或 Groq（OpenAI 兼容接口）

OpenAI API Key 字段必须填写真实的 API 密钥，不能填写接口地址。接口地址单独填写到 `OpenAI Compatible API Base URL`：

- OpenAI：API Key 在 [OpenAI API Keys](https://platform.openai.com/api-keys) 创建；Base URL 保持 `https://api.openai.com/v1`。
- Groq：在 [Groq API Keys](https://console.groq.com/keys) 创建真实的 Groq API key；在软件的 Base URL 字段填写：

  ```text
  https://api.groq.com/openai/v1
  ```

  然后把 **Groq API key** 粘贴到 `OpenAI API Key` 字段，并将 AI 候选来源选择为 `OpenAI`。上面的 URL 不是密钥，不能粘贴到密码框中。

软件会把 API 密钥使用 Windows Electron `safeStorage` 加密后保存在本机；Base URL 只作为本机设置保存。发布到 GitHub 时不要提交任何真实密钥、凭据文件或 `.env` 文件。

## Recommendation behavior

- 导入歌单只用于建立画像，绝不直接作为推荐池。候选来自 Last.fm 相似收听和可选 AI 画像扩展；QQ 榜单只作为热度证据，不会随机注入榜单歌曲。
- 每组推荐目标为 70%“保险热门”和 30%“个性探索”，最多 10 首；同一结果内同歌名、同歌手各只保留一首。
- 动态 QQ 评论门槛：高相似度大于 500，中等相似度大于 1,000，低相似度大于 2,000。若评论数据缺失，必须由 Last.fm 听众数、播放数或 QQ 榜单中的至少两个独立信号证明热度；已知评论低于门槛时直接拒绝。
- Live、DJ、Remix/Mix、加速、降速、变调、片段、铃声、伴奏、节目/播客、短视频热梗和少于 90 秒的版本会在排序前剔除。
- 歌单已有的同一原唱直接排除；同名翻唱只有 QQ 评论达到 10,000 以上才允许进入候选。
- 普通曝光 7 天内不再出现；喜欢、收藏和不感兴趣永久排除同一首；“已听过”排除 90 天。不感兴趣还会降低相关歌手和风格权重。
- 候选池本地最多保留 1,000 首，并随不同歌单种子分页扩充。外部服务失败时保留旧缓存，不放宽质量门槛。

## Windows packaging

```powershell
npm.cmd install
npm.cmd run package:win
```

The portable executable is written to `release-portable/Daily-Discovery-0.8.0-portable.exe`. An NSIS installer can be attempted with `npm.cmd run package:win:installer`; on some Windows machines, antivirus or controlled-folder protection may block the final installer file even though the unpacked application has been built successfully.
