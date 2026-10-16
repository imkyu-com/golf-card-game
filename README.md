# ⛳ 3D 高尔夫纸牌（Golf Card）· 网页原型

Three.js 写的 3D 网页版 6 张牌 Golf 纸牌：有闯关、AI 对手和本地社交功能。没有后端，也不依赖 CDN，所有依赖都打包在本地。

## 运行
```bash
npm install
npm run dev          # 开发服务器 http://localhost:5173/（vite.config.js 已绑定 0.0.0.0）
npm run build        # 产物输出到 dist/（base 为 '/'，对应自定义域名根路径）
npm run preview      # 本地预览 dist/，端口 5173，路径同样是 /
npm test             # Node 跑规则、计分、AI 对局模拟和挑战链接编解码的测试
npm run screenshots  # 无头 Chrome 冒烟测试 + 截图（需要先 preview，并安装 /usr/bin/google-chrome）
```

## GitHub Pages

推送到 `main` 后，`.github/workflows/pages.yml` 会执行 `npm ci` 和 `npm run build`，再用 GitHub Actions 发布到 <https://golf-card-game.app.imkyu.com/>。`public/CNAME` 会原样进到 `dist/`，告诉 Pages 使用这个自定义域名。

挑战链接用当前页面的 origin 和目录路径（`pageBase`），所以根路径和子路径下生成的 `#c=` 链接都打开当前站点，而不是写死某段 base。

## 目录
```
src/game/rng.js        带种子的随机数（mulberry32）和种子哈希
src/game/rules.js      规则状态机（纯函数，不碰 DOM，以后可以直接拿去做服务端裁判）
src/game/ai.js         AI：按“期望分”估值；分三档：easy 用阈值，normal 估期望值，hard 额外考虑摸牌期望、不给下家喂牌、只在领先时收尾
src/game/levels.js     10 个关卡（对手数量、难度、局数、特殊规则、星级线）
src/scene/scene3d.js   3D 牌桌、灯光阴影、声明式布局 + 补间动画、射线拾取
src/scene/cardTextures.js  用 Canvas 程序化画牌面和牌背
src/social/backend.js  数据层接口，原型阶段是 LocalBackend（localStorage）
src/social/share.js    挑战链接编解码、战绩文字、战绩卡 PNG
src/audio.js           WebAudio 合成的音效
src/main.js            界面（首页、地图、对局 HUD、结算、排行榜、教程）和对局流程
tests/logic.test.mjs   逻辑测试
scripts/screenshots.mjs 端到端截图脚本
```

## 规则
- 每人 2×3 共 6 张牌，开局翻开 2 张。轮到自己时，从牌堆或弃牌堆摸一张，和自己的任意一张牌交换。从牌堆摸的牌也可以直接弃掉，然后翻开自己一张暗牌。
- 同一列两张点数相同，这一列记 0 分，对局中的「明牌」、牌上的徽章、列高亮和终局总分用的是同一次计分。分值：A=1，2=-2，3–10 按牌面，J/Q=10，K=0（「国王之怒」里单张 K 是 +12），王=-2（只在有王牌的关卡出现）。
- 一对 2 或一对王牌也是 0 分，不是 -4。一对 K 在 K=+12 的关卡里同样是 0，不是 +24。四条（两列相同点数的对子）另加奖励（例如 -10），这个奖励加在已经抵消成 0 的对子上，不会把对子的点数加回来。
- 有人 6 张全翻开后，其他人各再走最后一回合，然后全部亮牌，再按同一规则计分。最后才翻开、从而凑成的对子也是 0，不会按翻开前的明牌分把其中一张算进总分。多局的总分是各局这个分数相加。

## 社交（原型，无后端）
- 昵称和头像存在 localStorage。
- 挑战好友：链接格式是 `…/#c=<base64url(JSON{seed,level,score,name,avatar,stars})>`。好友打开链接，就拿到同一个 seed，每一局的发牌完全相同。好友的成绩会写进本机排行榜，标记为“好友挑战”。
- 战绩卡：Canvas 生成 1080×1350 的 PNG，可以下载；也可以复制战绩文字。支持系统分享的设备上，可以调用 `navigator.share`。

## 以后接入真实后端
1. **全球排行榜和账号**：按 `LocalBackend` 的同一套接口写 `RemoteBackend`（getProfile/saveProfile/saveLevelResult/submitScore/getLeaderboard/recordChallenge），然后在 `main.js` 里替换。服务端可以用 seed 和操作序列回放 `rules.js`，以此校验成绩、防作弊。
2. **挑战链接**：现在把数据直接编码进 URL。以后可以改成服务端生成短 ID（`/c/AbC123`），还能统计有多少人应战。
3. **在线对战**：`rules.js` 是纯状态机，所有操作都是 `drawFromDeck / takeDiscard / swapHeld / discardHeld / flipAfterDiscard`，可以直接放到 WebSocket 服务端做权威裁判。客户端只发操作，收到状态后调用 `scene.layout(state)`（声明式渲染，任何状态都能直接画出来）。`main.js` 里的 `humanTurn / aiTurn` 可以再抽象出一个 `RemotePlayer`，等待网络消息。
4. 注意：开局时 AI 也用 seed 派生的随机数，但它的决策会受人类操作影响，所以挑战模式能保证**发牌相同**，不保证 AI 的每一步都相同。

## 已知问题和限制
- 手机竖屏下牌比较小，还没有“点击放大自己手牌”的交互。
- 发牌和翻牌动画没有设置“快进”或速度选项；AI 每回合大约 1.5 秒。
- 没有完整的手机实机测试，只在无头 Chrome 里模拟了 390×844 触屏视口。
- 打包后的 three.js 约 520KB（gzip 后约 140KB），还没做代码分割。
