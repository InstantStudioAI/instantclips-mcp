# InstantClips MCP

**English** · [Español](README.es.md) · [简体中文](README.zh-CN.md)

[InstantClips](https://instantclips.ai) turns an e-commerce product into short-form vertical
video for TikTok, Instagram Reels and Stories. It runs a hosted **MCP server**, so Claude Code,
Codex, Cursor, VS Code, the Claude app, ChatGPT or any other MCP client can do what the web app
does: import a product, draft the creative direction, and render the video.

**The product server stays hosted.** This repository contains its connection guide, registry
metadata, example HTTP client and a small open-source stdio adapter for clients that cannot connect
to a remote server directly. The adapter answers initialization, ping and tool discovery from a
generated snapshot, then sends authenticated tool calls to the hosted endpoint. The hosted server
remains the source of truth; the product implementation is not duplicated here.

## Endpoint

|            |                                            |
| ---------- | ------------------------------------------ |
| Endpoint   | `https://app.instantclips.ai/mcp`          |
| Transport  | Streamable HTTP, stateless                 |
| Method     | `POST`, JSON-RPC 2.0                       |
| Auth       | `Authorization: Bearer <token>`            |

Mint a token at **[app.instantclips.ai/settings#ai-access](https://app.instantclips.ai/settings#ai-access)**.
The token is a handle on your own account: same brands, products, credits and plan limits as the
web app. Signing in creates an account if you do not have one, with free credits to start.

Opening the endpoint in a browser returns the setup page rather than a protocol error, with
one-click install buttons that fill your token in for you.

## Install

Connect to the hosted endpoint directly whenever your client supports Streamable HTTP. Use the
stdio adapter below only for clients and automated runners that require a local command.

### Claude Code

```bash
claude mcp add --transport http instantclips https://app.instantclips.ai/mcp --header "Authorization: Bearer YOUR_TOKEN"
```

### Codex

Add to `~/.codex/config.toml`, which covers the CLI, the app and the IDE extension together:

```toml
[mcp_servers.instantclips]
url = "https://app.instantclips.ai/mcp"
http_headers = { Authorization = "Bearer YOUR_TOKEN" }
```

To keep the token out of the file, swap the header for `bearer_token_env_var = "INSTANTCLIPS_TOKEN"`
and export it in your shell instead.

### Stdio-only clients and headless runners

The `instantclips-mcp` npm package is a thin stdio-to-HTTPS adapter. It serves initialization and
tool discovery locally for a fast, credential-free cold start, then reads the token from the
environment and sends tool calls to InstantClips:

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

For an automated connectivity check, including the live tool names:

```bash
INSTANTCLIPS_TOKEN="your-token" npx -y instantclips-mcp --check --json
```

The token is accepted only through `INSTANTCLIPS_TOKEN`, never as a command-line argument, so it
does not appear in the process list. It is required for tool calls, but not for `initialize`,
`ping`, or `tools/list`. Node.js 20 or newer is required.

### Cursor and VS Code

One-click install buttons are on the [setup page](https://app.instantclips.ai/settings#ai-access).
They fill in your token once you have minted one.

### Claude app and ChatGPT

These connect through their own connector settings rather than a file. Point one at
`https://app.instantclips.ai/mcp` and authenticate with the same token — a request header in
Claude, an API key in ChatGPT. Claude's request headers are still in beta, and ChatGPT requires
developer mode; availability there depends on your account and workspace policy.

### Anything else

OpenClaw, Hermes, or an agent you wrote yourself: point it at the URL over streamable HTTP with an
`Authorization: Bearer` header. Nothing on the wire is InstantClips-specific, so a client that
speaks MCP already speaks this.

## Tools

The workflow, in order:

1. **Import** — `import_product_from_url` for a store page, or `create_product_from_images` when
   there is no page to read.
2. **Wait for the draft** — poll `get_product` until the import and the creative direction have
   finished.
3. **Read and steer it** — the direction comes back as text: hook, content focus, format,
   execution guidelines, restrictions. `update_video_direction` edits it, `redraft_video_direction`
   asks for another angle.
4. **Render** — `generate_video`.
5. **Collect** — poll `get_video` for the finished MP4 and a public share link.

Brands work the same way: `list_brands`, `create_brand`, `set_product_brand`. Every video is
drafted in a brand's voice, so an import whose storefront matches no existing brand stops and asks
rather than guessing.

Each tool's exact parameters are published by the hosted server. The generated
[`manifest/instantclips-mcp.json`](manifest/instantclips-mcp.json) snapshot lets stdio clients and
registries inspect those same schemas without a credential. Maintainers refresh it with
`INSTANTCLIPS_TOKEN="..." npm run sync:manifest`; `npm run check:manifest` fails when the committed
snapshot differs from the live server. Run `python example.py tools` below when you specifically
want to print the live schemas over HTTP.

## Credits

Importing a product, drafting the creative direction and editing it are all **free**.
`generate_video` is the only tool that spends credits, and it requires your explicit go-ahead — the
tools report the cost first. An agent cannot quietly run up a bill. See
[pricing](https://instantclips.ai/#pricing).

## example.py

A dependency-free MCP client — Python 3.9+, standard library only, no `pip install`.

```bash
export INSTANTCLIPS_TOKEN="your-token"

python example.py tools                 # every tool, with its live input schema
python example.py call list_brands '{}' # call one tool with JSON arguments
```

`tools` is the one to run first: it prints the real parameter names and types for every tool, which
is what you need before scripting the workflow above.

## Links

- [instantclips.ai/automate](https://instantclips.ai/automate/) — what the automation is and what
  it is for. It does not repeat the setup; this file and the app's setup page are where that lives.
- [app.instantclips.ai/llms.txt](https://app.instantclips.ai/llms.txt) — machine-readable
  description of the product and the tool sequence
- [Terms](https://app.instantclips.ai/terms) · [Privacy](https://app.instantclips.ai/privacy)

## Registry

`server.json` is this server's entry in the [official MCP registry](https://registry.modelcontextprotocol.io),
which the other directories ingest from. One `ai.instantclips/instantclips` entry carries both the
hosted endpoint in `remotes` and the stdio adapter in `packages`, so a host can choose the transport
it supports without creating two identities for the same tool surface.

The npm package's `mcpName` must exactly match that registry name. The repository link points to the
open-source adapter; the hosted product implementation is not in this repository.

The `ai.instantclips` namespace is the reverse-DNS of the domain, which requires publishing under
DNS or HTTP domain auth rather than GitHub auth. Authenticating with GitHub instead would force the
entry into `io.github.instantstudioai/...` and give up the branded namespace.

Publish the npm package first, then re-publish this same registry entry with
`mcp-publisher publish` after bumping its `version`. Domain authentication keeps the branded
`ai.instantclips` namespace; do not replace it with an `io.github.*` name. The signing key stays out
of the repository — `.gitignore` covers `*.pem`, and a committed private key is a published one.

`glama.json` is the separate, Glama-specific file that claims the listing there. A server under an
organisation rather than a personal account can only be claimed with that file present.
It carries ownership only. In Glama's Dockerfile form, use build steps
`["npm install --omit=dev"]`, CMD arguments `["node", "./bin/instantclips-mcp.js"]`, and any dummy
value for the required `INSTANTCLIPS_TOKEN` placeholder. Glama's initialization and tool-quality
checks use the bundled manifest and never transmit that placeholder upstream. Do not put a real
account token into a third-party build sandbox.

## License

MIT — see [LICENSE](LICENSE). The license covers this repository's contents; use of the hosted
service is governed by the [Terms of Service](https://app.instantclips.ai/terms).
