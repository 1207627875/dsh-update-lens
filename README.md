# dsh-update-lens

[![license: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![dsh-plugin](https://img.shields.io/badge/dsh--plugin-DeepSeek%20Harness-3772ff)](https://github.com/topics/dsh-plugin)

> DeepSeek Harness (dsh) 的**只读**更新检查插件：在「设置」里告诉你官方最新版、你当前版本、**更新内容**，
> 并把发布说明里**可能弄坏你东西的改动逐条标红**。发现新版本会在界面里提醒你 —— 但它**永远不会替你更新**。

[English](README.en.md) · 中文

---

## 为什么会有它

dsh 更新很频繁，而发布说明里混着「新增功能」和「某个包名不再兼容、你的插件要改」。
你真正需要的只有两件事：**有没有新版**、**这次更新会不会弄坏我正在用的东西**。
这个插件只做这两件事，并且**自己绝不动手**：升级命令它只给你复制，敲不敲由你。

## 界面位置

| 位置 | 内容 |
| --- | --- |
| 设置 → **更新中心**（导航 160 位） | 当前版本 / 最新版本 / 通道 / npm dist-tags、更新内容（中英对照）、风险标注、网络来源、设置项、手动更新命令 |
| 右下角浮层通知 | 发现新版本时出现，含「复制命令 / 暂不显示 / 忽略此版本」 |
| 设置导航项 | 有更新时标签变成「更新中心 ●」 |

## 破坏性变更标注（与同类插件的主要差别）

发布说明里每条条目会被标注成两档，条目左侧加色条 + 徽章，**鼠标悬停可看到命中的词**（不做黑箱判定）：

| 档位 | 含义 | 典型命中词 |
| --- | --- | --- |
| ▲ **破坏性**（红） | 东西被拿掉了 / 不再兼容 / 你必须动手 | 不兼容、不再、移除、删除、弃用、重命名、必须、请开发者检查、需适配、需更新、需手动、removed、no longer、deprecated、must、developers should |
| ! **注意**（黄） | 行为、默认值、接口动了 | 调整、改为、变化、上限、取消、回滚、changed、default、adjust、disable |

另外两条规则：

- **接口 + 变动 = 破坏性**：「相关 API 及 slot 有变化」「with changes to related APIs and slots」—— 这正是最容易弄坏第三方插件的情形。
- **按小节降噪**：「问题修复 / Bug Fixes」「新增功能 / 体验优化 / New Features / Improvements」小节里只有顶格词才算破坏性，
  所以「修复…无法恢复的问题」「correct added/deleted line counts」这类不会被误报。

页面呈现：每张版本卡有「N 条破坏性 / M 条需留意」汇总 + **只看风险项** 过滤；若待升级版本含破坏性变更，
会在「手动更新命令」**上方**再给一条红条提醒（命令是要粘进终端的，提醒必须先于它被读到）。

规则不是拍脑袋定的：`tests/notes-rules.mjs` 用**真实 Release 正文**（`tests/fixtures/`）跑 54 条断言，
其中相当一部分是「这些长得像的句子**不准**报警」的反向断言 —— 每一条都对应一个真的误报过的例子。

**每张卡片可单独「忽略」**：版本多了列表不会一直堆下去。忽略只收起卡片，不影响「落后几个版本」这些事实；
顶部会出现「已忽略 N 个版本 + 全部恢复」，随时可撤销。若被忽略的正好是你将要升级到的那个版本，它的通知也一并静音
（否则按钮看起来会像坏的）。

## 安装

```sh
# 1) 装进 profile（把 web 换成你的 profile 名）
dsh plugin --profile web add github:1207627875/dsh-update-lens

# 2) 在「设置 → 插件」里启用它；或手动把 dsh-update-lens 加进该 profile package.json 的 dsh.profile.bundles 数组

# 3) 重启 profile（Host 侧代码需要重启加载；客户端改动刷新页面即可）
```

**也可以让 AI 助手装**（本生态常见做法）：把下面这段直接发给任意 AI 编程助手 ——

```text
请帮我在当前环境安装 DeepSeek Harness (dsh) 插件 dsh-update-lens：
1. 在启用中的 profile 里执行：dsh plugin --profile <profile名> add github:1207627875/dsh-update-lens
2. 把 dsh-update-lens 加入该 profile package.json 的 dsh.profile.bundles 数组
3. 重启该 profile，然后 GET http://127.0.0.1:3080/dsh-update-lens/status，确认返回 JSON 且 current.version 是我的 dsh 版本
```

要求：dsh `>= 0.1.6-alpha.2`（本插件只在这个版本上实测过），Node `>= 20`。

## 数据源与网络

| 来源 | 用途 | 说明 |
| --- | --- | --- |
| `registry.npmjs.org` | 版本号、dist-tags、发布时间 | 主源；国内可直连 |
| `registry.npmmirror.com` | 同上 | 主源失败时的备用 |
| `api.github.com/.../releases` | **更新内容** | 可换成你自己信任的镜像前缀 |

判定按 semver 比较（含 `alpha.2 < alpha.10`、`0.1.6 > 0.1.6-alpha.2` 这类预发布规则）。
默认「跟随当前通道」——你装的是 `alpha` 就只盯 alpha；也可切成「任意通道最新版」。
dist-tag 出现**降级陷阱**（例如 `latest` 指向比你已安装更低的版本）时会单独告警。

**代理**：插件默认直连，**不读取系统（WinINET）代理** —— 系统里残留一个失效的代理设置不会让检查失败。
它只认两种代理：设置页里填的，或启动环境里的 `HTTPS_PROXY` / `HTTP_PROXY`。
走代理时代理与请求必须取自**同一份 undici**（Node 内置 `fetch` 会拒绝另一份拷贝的 `ProxyAgent`，报 `UND_ERR_INVALID_ARG`）；
若不满足，页面会明确显示「代理不可用，已回退直连」，**绝不假装代理生效**。
来源列表里每条都会标出本次实际走的**直连/代理**、耗时与错误。

## 设置项

- 启用后台自动检查（默认开，启动后 8 秒首检，不阻塞启动）
- 检查间隔（15 – 10080 分钟，默认 360）
- 检查范围：跟随当前通道 / 任意通道最新版
- 发现新版本时弹出提醒
- HTTP(S) 代理（留空 = 直连；接受 `127.0.0.1:7890` 这种省略协议的写法）
- GitHub API 地址（可填镜像）
- 忽略此版本（通知里的按钮）

设置与缓存落在 `$DSH_HOME/dsh-update-lens/{config,state}.json`（`$DSH_HOME` 默认 `~/.dsh`）。

## 截图

| 整页 | 破坏性变更标注 |
| --- | --- |
| ![更新中心整页](docs/screenshot-1-overview.png) | ![破坏性变更标注](docs/screenshot-2-breaking.png) |

| 完整更新内容 + 只看风险项 | 网络来源与设置 |
| --- | --- |
| ![完整更新内容](docs/screenshot-3-notes.png) | ![网络来源与设置](docs/screenshot-4-settings.png) |

截图取自真实运行环境（dsh `0.1.6-alpha.2`）。右下角**通知弹窗**那张要真的有新版本时才截得到，
清单与截法见 [`docs/SCREENSHOTS.md`](docs/SCREENSHOTS.md)。

## 自测

```sh
node tests/secret-scan.mjs       # 隐私扫描：密钥/token/凭据/个人路径 + PNG 文本块 + git 全历史
node tests/encoding-check.mjs    # 编码守卫：UTF-8 / BOM / 乱码 / 语法（每次批量改文件后必跑）
node research/verify-remote.mjs  # 以远端为准：下载 tar 包，逐文件 SHA-256 比对 + 在远端副本上再扫一遍
node tests/notes-rules.mjs       # 破坏性标注规则（真实正文 fixtures，54 条断言，含反向断言）
node tests/ignore-versions.mjs   # 每版「忽略 / 恢复」：持久化、可撤销、忽略目标版本时同静音通知
node tests/proxy-path.mjs        # 直连 / 死代理 / 活代理三条路径的真实行为
node tests/host-runtime.mjs      # 版本识别的**不变量**（不写死当天版本号；离线自动 skip）
node tests/host-smoke.mjs        # 路由表、同源防护、真实网络、卸载清理
node tests/resolve-check.mjs     # 安装位置自检：profile 链接、bundles 列表、客户端 bundle 路径
node tests/net-probe.mjs         # npm / GitHub 可达性
node tests/mirror-probe.mjs      # GitHub 镜像可达性
```

## 隐私

这个仓库里**没有任何密钥、token、凭据或个人路径**，而且不是靠"我看过了"来保证的：

- `tests/secret-scan.mjs` 扫三处：工作区文本、**git 全历史的所有 blob**（提交过又删掉的东西照样会被翻出来）、
  以及**截图的 PNG 文本块**（截图除了像素还可能带 tEXt/iTXt/EXIF 元数据，肉眼看图是看不出来的）；
- 另外单独比对长随机串供人工复核，避免"只认已知前缀"的盲区；
- `research/verify-remote.mjs` 下载 GitHub 上**实际发布的 tar 包**，解开来逐文件 SHA-256 比对，
  并在远端副本上再跑一次隐私扫描 —— 回答的是"远端到底有什么"，而不是"我以为推了什么"。

本插件也不需要任何密钥就能工作：它只读公开的 npm registry 与 GitHub Releases。

## 它不是什么（诚实说明）

- **不自动更新**，不下载、不替换、不改你的 npm 全局包。想要「一键更新 + 备份回滚」的请用
  [Airmetro/dsh-update-checker](https://github.com/Airmetro/dsh-update-checker)。
- **只管 dsh 本体**，不检查你装的第三方插件有没有新版；那件事用
  [stuarthu/dsh-update-notifier](https://github.com/stuarthu/dsh-update-notifier) 或插件市场类插件，两者不冲突。
- 破坏性标注是**关键词规则**，不是语义理解：每条判定都能解释（命中词可查），但会漏掉措辞里没有信号的破坏性改动，
  也可能给措辞强烈的普通改动标红。中英不对称时按**更严重**的一侧计数。
- 只读取公开信息：网络请求全是 GET；仅有的写接口（`/check`、`/config`、`/dismiss`）只写自己的配置文件，且要求同源。

## 开发约定：编码安全

本仓库有一条**硬性**规范，起因是一次真实事故：用 PowerShell 批量替换时，
文件被按系统代码页（GBK）读取后又以 UTF-8 写回，中文全部乱码；`更新中心 ●` 里 `●` 的字节丢失后
**吞掉了结束引号**，产生 `SyntaxError: Invalid or unexpected token`，插件直接无法加载。因此：

1. 所有源码 / 配置 / 文档一律 UTF-8（**无 BOM**）；
2. 文本读写必须显式声明编码；**禁止**用未指定编码的 PowerShell `Get-Content` / `Set-Content` 处理含中文的文件；
3. 每次批量改文件后必须跑 `node tests/encoding-check.mjs`，提交前 `git diff` 逐项确认中文与特殊字符无乱码；
4. 报 `SyntaxError` 一律视为未完成，禁止跳过。

`.gitattributes` 固定了文本文件的 eol，避免 Git 在平台间改写内容。

## 常见问题

**推送 / 克隆时报 `Connection was reset`？** 大陆网络直连 `github.com` 的 git 传输常被重置
（`api.github.com` 一般仍可用，所以 `gh` 的 API 操作正常、只有 git 传输会断）。给 git 单独配代理即可：

```sh
git config --local http.proxy http://127.0.0.1:7890    # 换成你自己的代理端口
```

**浏览器打开 GitHub 显示「访问暂时受限」？** 那是 GitHub 对**出口 IP** 的防滥用拦截
（页面会写明是哪个 IP）。换一个代理节点，或等它自行解除。

**装完看不到「更新中心」？** Host 侧代码需要**重启 profile** 才会加载；客户端改动刷新页面即可。
可以先 `curl http://127.0.0.1:3080/dsh-update-lens/status` 确认 Host 侧是否已起。

## 许可

[MIT](LICENSE) © 2026 1207627875
