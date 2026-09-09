# InstantClips MCP

[English](README.md) · [Español](README.es.md) · **简体中文**

[![M8ven Verified](https://m8ven.ai/badge/mcp/instantclips-mcp-1k56q7?variant=verified)](https://m8ven.ai/mcp/instantclips-mcp-1k56q7)

[InstantClips](https://instantclips.ai) 可将电商商品转化为适用于 TikTok、Instagram Reels 和
Stories 的竖屏短视频。它提供托管的 **MCP 服务器**，因此 Claude Code、Codex、Cursor、
VS Code、Claude 应用、ChatGPT 或其他任何 MCP 客户端都能完成网页应用中的工作：导入商品、
撰写视频方案并生成视频。

**这不是文本生成视频工具。** InstantClips 会读取商品页面（图片、价格、详情），基于页面上真实存在的
内容制作广告。方案先写好并展示给你，视频再按方案生成。正因如此，它便宜到可以跑完整个商品目录，
而且结果就是你在售的商品，而不是凭空猜测。

免费开始：赠送的算力足够生成第一条视频，无需绑定银行卡。之后可购买一次性算力包，或为同时运营
多个品牌的用户提供 Agency 会员。详见[价格](https://instantclips.ai/#pricing)。

- **适合搭配。** 搭配 Postiz、Buffer 之类的排期工具，直接发布生成的视频；搭配归因工具，看哪个
  开场钩子有效；在只有商品页面、没有素材的情况下，替代剪辑师。
- **不适合。** 电影级品牌大片、照稿念词的出镜主持人、横屏 4K、既没有页面也没有图片的商品。
- **为谁而建。** Shopify 卖家、dropshipping 卖家、品牌，以及同时为多家店铺运营社媒的代理机构。

**产品服务器仍以托管方式运行。** 本仓库包含连接指南、注册表元数据、示例 HTTP 客户端，以及一个
面向无法直接连接远程服务器的客户端的小型开源 stdio 适配器。适配器通过生成的快照在本地响应
初始化、ping 和工具发现，只有经过身份验证的工具调用才会发送到托管端点。托管服务器仍是唯一的
事实来源；本仓库不会复制产品实现。

## 端点

|          |                                                                              |
| -------- | ---------------------------------------------------------------------------- |
| 端点     | `https://app.instantclips.ai/mcp`                                            |
| 传输方式 | Streamable HTTP，无状态                                                      |
| 方法     | `POST`，JSON-RPC 2.0                                                         |
| 身份验证 | 客户端提示时登录（OAuth 2.1）；无浏览器的调用方使用 `Authorization: Bearer <token>` |

把一个地址粘贴进你的助手，提示时登录即可。设置就这么多。第一次调用时，服务端会带你登录
InstantClips 并请你授权，无需复制任何密钥。你授权过的每个助手都列在设置里的**已授权应用**中，
可以随时断开。

连接的是你自己的账户：与网页应用相同的品牌、商品、算力和方案限额。如果你还没有账户，登录时会
自动创建账户，并赠送可用于第一条视频的算力。

在浏览器中打开端点时会显示[设置页面](https://app.instantclips.ai/mcp)，而不是协议错误；页面上有
Cursor 和 VS Code 的一键安装按钮。

## 安装

如果客户端支持 Streamable HTTP，请直接连接托管端点，首次使用时会引导你登录。只有脚本和无法打开
登录页的自动化运行环境，才需要使用令牌和下方“没有浏览器？”一节中的 stdio 适配器。

### Claude Code

```bash
claude mcp add --transport http instantclips https://app.instantclips.ai/mcp
```

然后在 Claude Code 里运行 `/mcp`，选择 InstantClips 登录。

### Codex

将以下配置添加到 `~/.codex/config.toml`。该配置同时适用于 CLI、应用和 IDE 扩展：

```toml
[mcp_servers.instantclips]
url = "https://app.instantclips.ai/mcp"
```

然后运行 `codex mcp login instantclips` 登录。

### Cursor 和 VS Code

[设置页面](https://app.instantclips.ai/mcp)提供一键安装按钮。按钮会打开应用并添加 InstantClips，
首次使用时登录。

### Claude 应用和 ChatGPT

Claude 应用：用这个地址添加自定义连接器，按提示登录。网页版 ChatGPT：在 设置 › Apps › 高级 中
开启开发者模式，再把地址添加为连接器；Business 或 Enterprise 工作区则由管理员发布为全员可用的
应用。ChatGPT 桌面版在 设置 › MCP 服务器 中填入同一地址，并与 Codex 共享配置。

### 其他 MCP 客户端或智能体

OpenClaw、Hermes，或你自己写的 agent：通过 Streamable HTTP 指向这个地址。服务端按标准方式公布
登录流程，遵循规范的客户端无需其他配置。无法打开登录页的，改用下方的令牌。

### 没有浏览器？使用访问令牌

脚本、CI 任务和无法打开登录页的 agent，改用长期有效的令牌鉴权。前往
**[app.instantclips.ai/settings#ai-access](https://app.instantclips.ai/settings#ai-access)**
生成令牌。它拥有你账号的全部权限，请勿提交到代码仓库。

使用令牌时，同样的客户端配置如下：

```bash
# Claude Code
claude mcp add --transport http instantclips https://app.instantclips.ai/mcp --header "Authorization: Bearer YOUR_TOKEN"
```

```toml
# Codex，位于 ~/.codex/config.toml
[mcp_servers.instantclips]
url = "https://app.instantclips.ai/mcp"
http_headers = { Authorization = "Bearer YOUR_TOKEN" }
```

如果不想把令牌写入 Codex 的配置文件，请将请求头配置替换为
`bearer_token_env_var = "INSTANTCLIPS_TOKEN"`，然后在 shell 中导出该环境变量。Claude 应用可在
连接器中以请求头的形式使用令牌（自定义请求头仍处于测试阶段）；ChatGPT 连接器通过登录流程
鉴权，而不是粘贴密钥。其他任何客户端发送 `Authorization: Bearer` 请求头即可。传输协议中没有
InstantClips 专用内容。

#### 仅支持 stdio 的客户端和无界面自动化

`instantclips-mcp` npm 软件包是一个轻量的 stdio 到 HTTPS 适配器。它在本地提供初始化和工具发现，
从而无需凭据即可快速启动；随后从环境变量读取令牌，并将工具调用发送到 InstantClips：

```json
{
  "mcpServers": {
    "instantclips": {
      "command": "npx",
      "args": ["-y", "instantclips-mcp"],
      "env": {
        "INSTANTCLIPS_TOKEN": "YOUR_TOKEN"
      }
    }
  }
}
```

如需自动检查连接并获取实时工具名称，请运行：

```bash
INSTANTCLIPS_TOKEN="your-token" npx -y instantclips-mcp --check --json
```

令牌只能通过 `INSTANTCLIPS_TOKEN` 提供，不能作为命令行参数传入，因此不会出现在进程列表中。
工具调用需要令牌，但 `initialize`、`ping` 和 `tools/list` 不需要。需要 Node.js 20 或更高版本。

## 入门提示语

先从这五句开始，替换成你的链接或商品名即可。

1. “给这个商品做一条视频广告：[URL]”
2. “把这个系列页面上的所有商品都导入，并为每一个起草方案。先不要生成。”
3. “给我看 [商品] 的方案，把开场钩子改成先说价格。”
4. “用三个不同的开场钩子，给 [URL] 做三条视频，方便我测试。”
5. “这个商品属于我的哪个品牌？确认后再做视频。”

## 工具

工作流程如下：

1. **导入** — 如果有店铺商品页面，使用 `import_product_from_url`；如果没有可读取的页面，则使用
   `create_product_from_images`。
2. **等待草稿** — 轮询 `get_product`，直到商品导入和方案起草完成。
3. **查看并调整** — 方案以文本返回，包含开场钩子、内容重点、形式、执行指南和限制条件。
   使用 `update_video_direction` 进行编辑，或使用 `redraft_video_direction` 获取另一个方向。
4. **生成** — 使用 `generate_video`，并传入 `expected_credit_cost`：即 `get_product` 报告并已告知用户的
   算力费用。费用不一致时会拒绝执行，不会扣费。
5. **获取结果** — 轮询 `get_video`，获取完成的 MP4 文件和公开分享链接。

为同一商品制作另一个视频，走的是同一流程：编辑或重新起草会打开下一个视频的草稿；没有草稿时调用
`generate_video` 会按上一方案再生成一版。已生成的视频本身无法修改。每次 `get_product` 的响应都带有
`next_step`，说明下一步该做什么。

品牌的操作方式相同：`list_brands`、`create_brand`、`set_product_brand`。每个视频都会采用对应品牌
的表达风格进行起草。因此，当导入商品的店铺与任何现有品牌都不匹配时，流程会暂停并询问，而不是
自行猜测。

每个工具的确切参数均由托管服务器发布。生成的
[`manifest/instantclips-mcp.json`](manifest/instantclips-mcp.json) 快照让 stdio 客户端和注册表无需
凭据即可检查同一组 schema。维护者使用
`INSTANTCLIPS_TOKEN="..." npm run sync:manifest` 更新快照；如果已提交的快照与线上服务器不同，
`npm run check:manifest` 会失败。如需通过 HTTP 输出实时 schema，请运行下方的
`python example.py tools`。

## 算力

导入商品、起草方案和编辑方案均为**免费**。只有 `generate_video` 会消耗算力，而且必须获得你的
明确许可；工具会事先报告费用，`generate_video` 再以 `expected_credit_cost` 接收这一数字，费用变动时拒绝执行。智能体无法在你不知情的情况下产生费用。详见
[价格](https://instantclips.ai/#pricing)。

## example.py

这是一个无第三方依赖的 MCP 客户端，仅需 Python 3.9 或更高版本和标准库，无需运行
`pip install`。它使用令牌鉴权，因为脚本没有可用于登录的浏览器。

```bash
export INSTANTCLIPS_TOKEN="your-token"

python example.py tools                 # 所有工具及其实时输入 schema
python example.py call list_brands '{}' # 使用 JSON 参数调用一个工具
```

请先运行 `tools`：它会输出每个工具真实的参数名称和类型，这是自动化上述工作流程前所需的信息。

## 链接

- [instantclips.ai/automate](https://instantclips.ai/automate/) — 介绍自动化的用途：一个由店铺页面
  生成的真实结果、入门提示语、按顺序排列的工具，以及相关规则。该页面不会重复设置说明；设置方法
  请参阅本文档和应用中的设置页面。
- [app.instantclips.ai/llms.txt](https://app.instantclips.ai/llms.txt) — 适合机器读取的产品说明和工具
  调用顺序。
- [服务条款](https://app.instantclips.ai/terms) · [隐私政策](https://app.instantclips.ai/privacy)

## 注册表

`server.json` 是该服务器在 [MCP 官方注册表](https://registry.modelcontextprotocol.io)中的条目，其他
目录会从中获取信息。同一个 `ai.instantclips/instantclips` 条目既通过 `remotes` 提供托管端点，
也通过 `packages` 提供 stdio 适配器。客户端可根据自身支持情况选择传输方式，无需为同一组工具创建
两个身份。

npm 软件包中的 `mcpName` 必须与该注册表名称完全一致。仓库链接指向开源适配器；托管产品的实现
不在本仓库中。

`ai.instantclips` 命名空间是域名的反向 DNS，因此发布时必须使用 DNS 或 HTTP 域名验证，而不能
使用 GitHub 身份验证。改用 GitHub 身份验证会强制使用 `io.github.instantstudioai/...`，从而失去
品牌命名空间。

先提升 `version` 并发布 npm 软件包，然后运行 `mcp-publisher publish` 重新发布同一注册表条目。
域名身份验证会保留品牌命名空间 `ai.instantclips`；请勿将其替换为 `io.github.*` 名称。签名密钥不
存放在仓库中：`.gitignore` 已忽略 `*.pem`，因为一旦提交私钥，就等于公开了私钥。

发布前再登录一次——注册表令牌不到一小时就会过期——域名验证走的是 HTTP 而非 DNS：营销站点上的
`instantclips.ai/.well-known/mcp-registry-auth` 提供这把密钥的公钥部分（`v=MCPv1; k=ed25519; p=…`），
没有 TXT 记录，所以 `login dns` 会报 "no MCP public key found"。

```bash
mcp-publisher login http --domain instantclips.ai \
  --private-key "$(openssl pkey -in key.pem -text -noout | awk '/priv:/{f=1;next} /pub:/{f=0} f' | tr -d ' :\n')"
mcp-publisher publish
```

`test/shim.test.js` 固定了快照的服务器版本和 `server.json` 的 `version`；每次发布都要同时更新这两处。

`glama.json` 是 Glama 专用的独立文件，用于认领该平台上的条目。归属于组织而非个人账户的服务器，
只有在该文件存在时才能完成认领。
该文件只用于证明所有权。在 Glama 的 Dockerfile 表单中，将构建步骤设为
`["npm install --omit=dev"]`，将 CMD 参数设为
`["node", "./bin/instantclips-mcp.js"]`，并为必填的 `INSTANTCLIPS_TOKEN` 占位参数填写任意虚拟值。
Glama 的初始化与工具质量检查只读取随包提供的清单，不会将该占位值发送到托管服务器。请勿把真实
账户令牌放入第三方构建沙箱。

## 许可证

MIT — 参见 [LICENSE](LICENSE)。该许可证适用于本仓库中的内容；托管服务的使用受
[服务条款](https://app.instantclips.ai/terms)约束。
