# 守岸人主题 · Shorekeeper Theme

给 DeepSeek Harness 的主题插件：启动时播放「逐笔线稿 → 睁眼 → 文字与标识」的守岸人影片，结束后把同一段画面作为全屏背景，侧边栏里提供交互面板，可换成自己的图片或视频，并调节界面透明度。

## 更新内容（v1.2.2）

- **启动语音提示**：人物睁眼后 0.5 秒播放提示语音，音量已做 +10 dB 增益并内嵌在 `client.js` 中。
- **伴侣插件**：新增桌宠、聊天终端、本地 GPT-SoVITS 语音（自动朗读 / 单条朗读 / 系统音色兜底）、音乐播放器（固定默认曲目、播放清单、波形可视化）、记忆与角色卡。
- **卸载按钮**：主题设置页底部新增「卸载主题」，确认后移除插件注册与链接；安装在 `_installed` 目录时会同时删除插件文件。
- 线稿解析改为分批处理（`requestIdleCallback`），消除热启动第一笔卡顿。

## 启动动画

- **逐笔线稿**：取 4K 原片睁眼前（3.0s）的定格，提取边缘并细化为 443 条矢量笔画；按「结构 → 中景 → 细节」三批、每条笔画独立的延迟与速度用 Canvas 逐帧绘制生长（不再用数百个 SVG 动画，首帧更顺滑），黑底星空与共鸣粒子作为衬底。
- **文字入场**：`DeepSeek` 与「守岸人正在苏醒」自下而上渐显，蓝色由右至左渐变。
- **睁眼融合**：源片硬切点（3.83s）触发闪光、下扫光与粒子爆发，线稿淡出、完整画面亮起；随后「守岸人正在苏醒」向下淡出，「欢迎回来，漂泊者」的每个字从左到右、从右往左逐字推入（位移 + 去模糊 + 渐显），每个字沿整行取蓝色渐变。
- **标识拼装**：黑海岸标识被拆成 24 个矢量部件，自右向左依次推入拼合；放大的「黑海岸」三个字随后逐字从右向左推入，英文 `BLACK SHORES` 最后淡入。整组标识位于 `DeepSeek` 正上方约三行处、左缘与字样对齐。
- 影片 1600×900 / H.264，静音自动播放，`object-fit: cover`，CSS 提高对比度（亮部更亮、暗部更暗）；`ESC`、点击或「跳过」立即结束。
- 启动动画挂在 `document.body` 的 portal 上，**覆盖整个窗口（含顶部菜单栏）**；Windows 原生的最小化/最大化/关闭按钮由系统绘制，网页层无法覆盖。
- **退场过渡**：粒子消散与聚合——把启动画面采样成数千个彩色光点，先向外扩散，再向中心汇聚并淡出，光点散尽时新的背景已经就位，形成「消散后聚合成背景」的衔接。
- 启动前在 `apply` 阶段立刻盖一层黑幕（boot veil），避免聊天界面先闪现。
- `prefers-reduced-motion` 下关闭粒子、笔画生长与位移动画。

## 主题背景

- 启动动画结束后，默认背景使用同一段「睁眼」画面做成的**无缝循环**：截取 6–10s，把结尾 0.7s 与开头交叉淡化后拼成 3.3s 的 `loop.mp4`，循环点看不到跳帧。
- 左侧栏新增「守岸人主题」入口，点击打开设置页：
  - **背景**：启动动画 / 图片 / 视频，支持拖入或点选文件（上限 120 MB），文件只保存在本机 IndexedDB。
  - **显示**：界面透明度（5%–85%）、背景压暗（0–85%）、背景模糊（0–30px），全部实时生效。
  - **启动动画**：开关每次启动播放，或手动「重播启动动画」。
- 界面透明通过 `ctx.theme.overrideTokens` 覆盖 `--dsw-alias-bg-base`、`--dsw-specific-sidebar-fill`、`--dsw-specific-input-major`、`--dsw-alias-bg-layer-1`，与用户当前主题（明/暗/跟随系统）叠加，不改动主题偏好。
- 所有设置保存在 `localStorage`（`dsh-shorekeeper.theme.v2`），随刷新/重启保留；关掉总开关会完全恢复原生外观。

## 伴侣

本包同时附带守岸人伴侣：桌宠、聊天终端、GPT-SoVITS 语音（自动朗读 / 单条朗读 / 系统音色兜底）、音乐播放器、记忆与角色卡。安装后桌宠出现在左下角，右键可打开终端与语音设置；关闭「连接守岸人」即停用伴侣，主题不受影响。

语音需要本机运行 GPT-SoVITS API（默认 `127.0.0.1:9880`），并在语音设置里选择 GPT / SoVITS 权重与参考音频。详细步骤见包内 `使用说明.txt`。

## 安装 / 卸载

解压到固定目录后，在 PowerShell 执行（把 `<解压目录>` 换成实际路径）：

```powershell
dsh plugin --profile desktop add "link:<解压目录>"
```

并确认 `@local/dsh-shorekeeper-startup` 在 `~/.dsh/profiles/desktop/package.json` 的 `dsh.profile.bundles` 中。完全退出并重启 DSH 生效。卸载：

```powershell
dsh plugin --profile desktop remove @local/dsh-shorekeeper-startup
```

也可以在「守岸人主题」设置页底部点「卸载主题」。手动安装、文件作用与注意事项见 `安装说明.txt`。

## 调整与重新构建

- 节奏：`client.template.js` 顶部 `RATE`、`CUT_AT`、`OUT_AT`、`LOOP_START/END`。
- 线稿：从新影片截取闭眼前一帧到 `assets/_new/frame_3s.png`，运行 `python tools/vectorize.py` 重新生成 `assets/sketch_paths.json`（含每条笔画的延迟与时长）。
- 标识：替换 `assets/logo.svg` 后运行 `python tools/split_logo.py` 生成 `assets/logo_parts.json`。
- 影片：替换 `assets/startup.mp4`。
- 然后运行：

```powershell
node build.mjs
```

构建会把影片、笔画路径、标识部件、启动提示音、桌宠立绘与默认音乐内嵌进 `client.js`（约 5.6 MB），插件因此不依赖任何外部资源；聊天、语音与音乐由 `index.js` 的 Host 路由提供。

## 结构

| 文件 | 作用 |
|---|---|
| `client.js` | 构建产物：内嵌影片、笔画、标识、提示音、桌宠立绘与默认音乐的浏览器 bundle |
| `client.template.js` | 主题 + 伴侣源码（React.createElement，无 JSX） |
| `build.mjs` | 生成 `client.js`，并内嵌 `assets/startup_voice.mp3` |
| `index.js` | Host 路由：聊天流、TTS、音色检测/配置、文件选择、默认音乐、卸载 |
| `cordis.patch.yml` | 插入 `shorekeeper-startup` 行 |
| `voicepack.json` | GPT-SoVITS 语音包配置（权重、参考音频、启动脚本） |
| `assets/startup.mp4` | 启动影片（1600×900、30fps、CRF 25） |
| `assets/startup_voice.mp3` | 睁眼提示音（+10 dB，延迟 0.5 秒） |
| `assets/sketch_paths.json` | 406 条线稿笔画与绘制时序 |
| `assets/logo.svg` / `logo_parts.json` | 黑海岸标识及其 24 个可拼装部件 |
| `assets/pet.png`、`portrait.webp`、`face.webp`、`butterfly.webp` | 伴侣立绘与界面装饰 |
| `assets/default_track.m4a` | 默认曲目「漂泊的终点」 |
| `安装说明.txt` / `使用说明.txt` | 安装步骤、文件作用与伴侣使用说明 |
| `locale/*.json`、`icon.svg` | 插件管理页的标题、描述与图标 |

## 素材

影片与标识来自用户提供的《鸣潮》素材。角色与影像版权归库洛游戏所有，本插件仅作本地个性化使用，不再分发这些素材。
