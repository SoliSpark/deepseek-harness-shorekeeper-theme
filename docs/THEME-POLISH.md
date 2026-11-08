# 主题补丁说明（沉浸式玻璃质感打磨）

本分支是在原有「Shorekeeper / 黑海岸」启动主题之上的一轮视觉打磨，**只改主题层**：
不修改 DeepSeek Harness 本体（`app.asar` 未动），不改启动影片/线条绘制素材，不改插件自身的
安装、开关与开屏逻辑；全部效果由注入的 CSS 与少量主题侧 JS 完成。

## 一、启动 / 开屏衔接

- **舞台幕布**：开屏期间给工作台加一层不透明幕布（`z-index: 2147482999`，760ms 淡出），
  避免「工作台先露出来、开屏后补上去」的闪烁；`replaySplash()` 开始时拉起、开屏结束（含异常兜底）时释放。
- **片尾交叉淡化**：片尾不再让影片「突然消失、粒子突然满亮」。
  - 影片 `.dshsk-media` 以 1500ms（延迟 60ms）缓慢淡出；
  - 粒子画布 `.dshsk-dissolve` 以 420ms 淡入；
  - 粒子生成加入 `bloom / rise` 曲线（0.30s 内升满、0.24s 内在局部升起），随粒子扩散逐渐变成画面碎点。
- **片尾文字下沉**：`outro` 阶段给标题文案加 `dshsk-copy-sink` 动画（900ms，下移 64px、
  轻微模糊、淡出），与粒子上升方向相反，收尾更自然；非 outro 的关闭动画仍走整体淡出。

## 二、层级与背景

- 页面背景层下沉到 `z-index: -1`，`body` 透明、`#root` 不再自建层叠上下文。
  这样主题背景动画能透到所有半透明面板下面，同时也修复了 DSH 的 `position: fixed` 浮层
  （文件预览、菜单）被正文盖住的问题。
- Windows 标题条 `.mP3x-q_frame:before` 的底色置空，让顶部 40px 标题条直接透出背景动画。

## 三、内容表面（可读性优先）

统一把「内容面」提到接近不透明，避免亮背景穿透影响阅读；其余表面按玻璃处理：

| Token | 浅色 | 深色 |
| --- | --- | --- |
| `--dsw-specific-input-major`（输入区） | 0.88 | 0.88 |
| `--dsw-alias-bg-layer-1`（卡片/预览） | 0.92 | 0.92 |
| `--dsw-alias-bg-layer-2` / `layer-3` | 0.94 | 0.90 前后 |
| `--dsw-alias-bg-overlay` | 0.92 | 0.88 前后 |
| `--dsw-alias-bg-module-platform` | 0.90 | 0.86 前后 |
| `--dsw-alias-bg-document-preview` | 0.94 | 0.90 前后 |
| `--dsw-alias-button-elevated-fill` / `button-floating-fill` | 0.90 | 0.86 前后 |
| `--dsw-menu-surface-fill` | 0.90 | 0.86 前后 |

菜单类表面保留 DSH 原有的 40px `backdrop-filter` 模糊，作为「玻璃遮罩」。

## 四、输入区

- 输入栏外层 `*_composerSeat`：去掉旧版模糊与座位渐变，只保留一份透明内联样式；
  内容底部用 mask 自然淡出，不再出现一条灰色过渡带。
- **「新会话」按钮液态玻璃**：JS 侧给 `*_newSession` 根节点打 `dshsk-liquid`，
  CSS 用 162° 白色渐变 + `blur(22px) saturate(1.85) brightness(1.05)` + 1px 内部高光 +
  内阴影 + 外投影；深色主题单独一套；并压制了内层透明按钮自带的高光，避免 hover 与其它卡片不一致。
- **热重载残留清理**：应用样式前先移除历史遗留的 `style[data-dsh-shorekeeper="theme"]` 与重复背景层；
  每 1200ms 对 `*_composerSeat` 写一次 inline `!important` 兜底（清除旧样式表残留的 blur / 底色）。
  这解决「输入框两侧和下方一直有模糊材质带」的历史问题。
- **停用还原**：`stopChromeBits` 停止轮询时，把 `*_composerSeat` 上由兜底写入的内联样式
  还原为写入前的原值（未动过的属性直接移除），关闭主题后不再残留透明覆盖。

## 五、引导卡与侧栏

- 右侧栏引导卡（工作区文件 / 新建终端 / 浏览器 / 更多工具）统一使用 DSH 原生卡片填充与 hover token，
  hover 亮度一致；「新建终端」因为内层透明按钮被清空，单独补 `--dsw-alias-interactive-bg-hover` 规则。
- 右侧栏面板与聊天区采用**同一套材质**（可读性优先），不再单独做更透的玻璃。
- 修复展开「思考」块时，sticky 折叠头重复铺一层底色导致的浅灰横带
  （`[data-disclosure-header]` 展开态底色置空，折叠态保持透明）。

## 六、消息与代码

- 代码块 / 内联代码 / 引用 / 代码段选中态统一降为中低透明度玻璃色（浅色 code-block 0.42、
  inline 0.38、citation 0.48、segment 0.45/0.32；深色再低 0.04–0.06），不再是刺眼的纯白底。
- 代码块顶部的 **sticky 标志栏**补不透明玻璃底（浅 `rgba(248,251,255,0.92)` + `blur(14px)`，
  深 `rgba(14,19,28,0.92)`），正文从下方滚过时不再从标志栏里透出来。

## 七、轨迹页

- 轨迹页（时间轴/表格）的根容器、工具条、分隔条、绘图区底色置空，直接使用页面背景动画；
  同时给表格与表头补透明规则，避免整页出现一块白底。

## 八、蓝色强调色

- `--dsw-alias-link`、`--dsw-alias-state-business-primary` 与品牌色 token：
  浅色主题 `#4176e6 → #1c3fbf`，深色主题 `#7aaaff → #a3c4ff`，提升在玻璃背景上的对比度。
- 输入框子树内把上述 token 还原为 DSH 原色，避免发送按钮 / 模型 chip 被一起改深。

## 九、平台页外壳（充值 / 查询用量）

- 这两页是 Electron 原生 `WebContentsView` 承载的外部网页（`platform.deepseek.com`），
  页面内部无法由主题改写；本补丁只调整外壳：
  - 遮罩层纸面底 `--dshsk-platform-paper`（浅 `rgba(251,252,255,0.985)` / 深 `#f7f9fc`）；
  - 48px 返回栏透明、返回与错误文字改为深色，加载状态不再露出下层应用界面。

## 十、兼容性与风险

- 仅在 **Windows 版 DeepSeek Harness Desktop** 上验证；macOS 的 `trafficLights` 分支未改动。
- 补丁通过 CSS Module 的类名（如 `.acoR2W_panel`、`.mP3x-q_frame`、`.MKE-pW_*`）与 DSH 主题
  token 生效；DSH 大版本升级若重命名这些类名，**只会导致对应样式不生效，不会报错或崩溃**。
- 不写 `localStorage` 设置、不影响插件的开关与安装。
- 若主题被关闭/卸载，所有改动随之失效；上游 `client.js` 始终可用 `git checkout` 恢复。

## 十一、构建

- 有完整 `assets/` 时：`node build.mjs`（上游原流程）。
- 仓库不带 `assets/` 时：`node build-from-bundle.mjs`，从已有 `client.js` 中提取四个内嵌字面量
  （影片 / 循环影片 / 线条路径 / 徽记部件）再注入模板，产物与 `build.mjs` 等价。
- 提交里的 `client.js` 即用上述方式重建，可直接安装。

## 十二、证据截图

见 `docs/previews/`：

| 文件 | 内容 |
| --- | --- |
| `splash-crossfade.png` | 开屏片尾：影片淡出与粒子淡入的交叉过程 |
| `guide-hover.png` | 引导卡 hover 统一 |
| `code-banner.png` | 代码块 sticky 标志栏不再透字 |
| `liquid-button.png` | 「新会话」按钮液态玻璃 |
| `topbar-immersive.png` | Windows 顶部标题条透出背景动画（系统按钮区仍由 Electron 原生绘制） |
