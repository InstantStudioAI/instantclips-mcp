# InstantClips MCP

[English](README.md) · [Español](README.es.md) · **简体中文**

[InstantClips](https://instantclips.ai) 可将电商商品转化为适用于 TikTok、Instagram Reels 和
Stories 的竖屏短视频。它提供托管的 **MCP 服务器**，因此 Claude Code、Codex、Cursor、
VS Code、Claude 应用、ChatGPT 或其他任何 MCP 客户端都能完成网页应用中的工作：导入商品、
起草创意方向并渲染视频。

**产品服务器仍以托管方式运行。** 本仓库包含连接指南、注册表元数据、示例 HTTP 客户端，以及一个
面向无法直接连接远程服务器的客户端的小型开源 stdio 适配器。适配器只负责将 MCP 消息转发到托管
端点；工具定义和产品实现仍然只保留在一个地方。

## 端点

|          |                                            |
| -------- | ------------------------------------------ |
| 端点     | `https://app.instantclips.ai/mcp`          |
| 传输方式 | Streamable HTTP，无状态                    |
| 方法     | `POST`，JSON-RPC 2.0                       |
| 身份验证 | `Authorization: Bearer <token>`            |

前往 **[app.instantclips.ai/settings#ai-access](https://app.instantclips.ai/settings#ai-access)**
生成令牌。该令牌关联你自己的账户，可访问与网页应用相同的品牌、商品、点数和方案限额。如果你还没有
账户，登录时会自动创建账户，并赠送可用于开始体验的免费点数。

在浏览器中打开端点时会显示设置页面，而不是协议错误；页面上的一键安装按钮会自动为你填入令牌。

## 安装

如果客户端支持 Streamable HTTP，请优先直接连接托管端点。只有在客户端或自动化运行环境必须执行
本地命令时，才使用下方的 stdio 适配器。

### Claude Code

```bash
claude mcp add --transport http instantclips https://app.instantclips.ai/mcp --header "Authorization: Bearer YOUR_TOKEN"
```

### Codex

将以下配置添加到 `~/.codex/config.toml`。该配置同时适用于 CLI、应用和 IDE 扩展：

```toml
[mcp_servers.instantclips]
url = "https://app.instantclips.ai/mcp"
http_headers = { Authorization = "Bearer YOUR_TOKEN" }
```

如果不想将令牌写入文件，请将请求头配置替换为
`bearer_token_env_var = "INSTANTCLIPS_TOKEN"`，然后在 shell 中导出该环境变量。

### 仅支持 stdio 的客户端和无界面自动化

`instantclips-mcp` npm 软件包是一个轻量的 stdio 到 HTTPS 适配器。它从环境变量读取令牌，将上游
端点固定为 InstantClips，并原样转发协议消息：

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
需要 Node.js 20 或更高版本。

### Cursor 和 VS Code

[设置页面](https://app.instantclips.ai/settings#ai-access)提供一键安装按钮。生成令牌后，按钮会自动
为你填入令牌。

### Claude 应用和 ChatGPT

这些客户端通过各自的连接器设置进行连接，而不是读取配置文件。将连接地址设为
`https://app.instantclips.ai/mcp`，并使用同一个令牌进行身份验证：Claude 使用请求头，ChatGPT
使用 API 密钥。Claude 的自定义请求头功能仍处于测试阶段，而 ChatGPT 需要开启开发者模式；具体
是否可用取决于你的账户和工作区政策。

### 其他客户端

无论是 OpenClaw、Hermes，还是你自己编写的智能体，只需通过 Streamable HTTP 连接该 URL，并
添加 `Authorization: Bearer` 请求头。传输协议中没有 InstantClips 专用内容，因此任何支持 MCP
的客户端都能与该服务器通信。

## 工具

工作流程如下：

1. **导入** — 如果有店铺商品页面，使用 `import_product_from_url`；如果没有可读取的页面，则使用
   `create_product_from_images`。
2. **等待草稿** — 轮询 `get_product`，直到商品导入和创意方向起草完成。
3. **查看并调整** — 创意方向以文本返回，包含开场钩子、内容重点、形式、执行指南和限制条件。
   使用 `update_video_direction` 进行编辑，或使用 `redraft_video_direction` 获取另一个方向。
4. **渲染** — 使用 `generate_video`。
5. **获取结果** — 轮询 `get_video`，获取完成的 MP4 文件和公开分享链接。

品牌的操作方式相同：`list_brands`、`create_brand`、`set_product_brand`。每个视频都会采用对应品牌
的表达风格进行起草。因此，当导入商品的店铺与任何现有品牌都不匹配时，流程会暂停并询问，而不是
自行猜测。

每个工具的确切参数均由服务器自身发布。本仓库有意不重复列出这些参数；请运行下方的
`python example.py tools` 来输出实时 schema，确保你构建的集成始终与服务器实际接受的参数一致。

## 点数

导入商品、起草创意方向和编辑方向均为**免费**。只有 `generate_video` 会消耗点数，而且必须获得你
的明确许可；工具会事先报告费用。智能体无法在你不知情的情况下产生费用。详见
[价格](https://instantclips.ai/#pricing)。

## example.py

这是一个无第三方依赖的 MCP 客户端，仅需 Python 3.9 或更高版本和标准库，无需运行
`pip install`。

```bash
export INSTANTCLIPS_TOKEN="your-token"

python example.py tools                 # 所有工具及其实时输入 schema
python example.py call list_brands '{}' # 使用 JSON 参数调用一个工具
```

请先运行 `tools`：它会输出每个工具真实的参数名称和类型，这是自动化上述工作流程前所需的信息。

## 链接

- [instantclips.ai/automate](https://instantclips.ai/automate/) — 介绍自动化功能及其用途。该页面不会
  重复设置说明；设置方法请参阅本文档和应用中的设置页面。
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

请先发布 npm 软件包，再增加 `version`，并运行 `mcp-publisher publish` 重新发布同一个注册表条目。
域名身份验证会保留品牌命名空间 `ai.instantclips`；请勿将其替换为 `io.github.*` 名称。签名密钥不
存放在仓库中：`.gitignore` 已忽略 `*.pem`，因为一旦提交私钥，就等于公开了私钥。

`glama.json` 是 Glama 专用的独立文件，用于认领该平台上的条目。归属于组织而非个人账户的服务器，
只有在该文件存在时才能完成认领。
该文件只用于证明所有权：在 Glama 中将构建命令设置为 `npm ci`，运行
`node bin/instantclips-mcp.js`，并在服务器管理界面中将 `INSTANTCLIPS_TOKEN` 配置为密钥。

## 许可证

MIT — 参见 [LICENSE](LICENSE)。该许可证适用于本仓库中的内容；托管服务的使用受
[服务条款](https://app.instantclips.ai/terms)约束。
