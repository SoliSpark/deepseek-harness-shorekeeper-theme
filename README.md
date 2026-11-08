# 守岸人主题 · Shorekeeper Theme

给 DeepSeek Harness 的主题插件：启动时播放「逐笔线稿 → 睁眼 → 文字与标识」的守岸人影片，结束后把同一段画面作为全屏背景，侧边栏里提供交互面板，可换成自己的图片或视频，并调节界面透明度。

## 启动动画

- **逐笔线稿**：取 4K 原片睁眼前（3.0s）的定格，提取边缘并细化为 443 条矢量笔画；按「结构 → 中景 → 细节」三批、每条笔画独立的延迟与速度用 `stroke-dashoffset` 生长出来，黑底星空与共鸣粒子作为衬底。
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

## 安装 / 卸载

已安装进 `desktop` profile（`link:` 到本目录）。手动安装：

```powershell
dsh plugin --profile desktop add "link:D:\Users\Documents\deepseek-harness\default-workspace\shorekeeper-startup"
```

并确认 `@local/dsh-shorekeeper-startup` 在 `~/.dsh/profiles/desktop/package.json` 的 `dsh.profile.bundles` 中。卸载：

```powershell
dsh plugin --profile desktop remove @local/dsh-shorekeeper-startup
```

## 调整与重新构建

- 节奏：`client.template.js` 顶部 `RATE`、`CUT_AT`、`OUT_AT`、`LOOP_START/END`。
- 线稿：从新影片截取闭眼前一帧到 `assets/_new/frame_3s.png`，运行 `python tools/vectorize.py` 重新生成 `assets/sketch_paths.json`（含每条笔画的延迟与时长）。
- 标识：替换 `assets/logo.svg` 后运行 `python tools/split_logo.py` 生成 `assets/logo_parts.json`。
- 影片：替换 `assets/startup.mp4`。
- 然后运行：

```powershell
node build.mjs
```

构建会把影片、笔画路径与标识部件内嵌进 `client.js`（约 2.9 MB），插件因此不依赖任何外部资源或 Host 路由。

## 结构

| 文件 | 作用 |
|---|---|
| `client.js` | 构建产物：内嵌影片/笔画/标识的浏览器 bundle |
| `client.template.js` | 源码（React.createElement，无 JSX） |
| `build.mjs` | 生成 `client.js` |
| `index.js` | Host 侧空实现，仅提供 Loader 入口 |
| `cordis.patch.yml` | 插入 `shorekeeper-startup` 行 |
| `assets/startup.mp4` | 启动影片（1600×900、30fps、CRF 25） |
| `assets/sketch_paths.json` | 443 条线稿笔画与绘制时序 |
| `assets/logo.svg` / `logo_parts.json` | 黑海岸标识及其 24 个可拼装部件 |
| `tools/vectorize.py` / `split_logo.py` | 线稿矢量化与标识拆分脚本 |
| `locale/*.json`、`icon.svg` | 插件管理页的标题、描述与图标 |

## 素材

影片与标识来自用户提供的《鸣潮》素材。角色与影像版权归库洛游戏所有，本插件仅作本地个性化使用，不再分发这些素材。
