# InstantClips MCP

[InstantClips](https://instantclips.ai) turns an e-commerce product into short-form vertical
video for TikTok, Instagram Reels and Stories. It runs a hosted **MCP server**, so Claude Code,
Codex, Cursor, VS Code, the Claude app, ChatGPT or any other MCP client can do what the web app
does: import a product, draft the creative direction, and render the video.

**This repository is not the server.** The server is hosted, there is nothing here to install or
run to use it, and no key ever leaves your machine except as a bearer token to the endpoint below.
What this repository holds is the connection guide, and one dependency-free script for reading the
live tool surface.

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

### Cursor and VS Code

One-click install buttons are on the [setup page](https://app.instantclips.ai/settings#ai-access).
They fill in your token once you have minted one.

### Claude app and ChatGPT

These connect through their own connector settings rather than a file. Point one at
`https://app.instantclips.ai/mcp` and authenticate with the same token — a request header in
Claude, an API key in ChatGPT. Claude's request headers are still in beta, and ChatGPT needs
developer mode on a Business or Enterprise workspace.

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

Each tool's exact parameters are published by the server itself. This repository deliberately does
not restate them — run `python example.py tools` below to print the live schemas, so what you build
against cannot drift from what the server accepts.

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

- [instantclips.ai/automate](https://instantclips.ai/automate/) — the MCP page, with the same
  configuration blocks
- [app.instantclips.ai/llms.txt](https://app.instantclips.ai/llms.txt) — machine-readable
  description of the product and the tool sequence
- [Terms](https://app.instantclips.ai/terms) · [Privacy](https://app.instantclips.ai/privacy)

## License

MIT — see [LICENSE](LICENSE). The license covers this repository's contents; use of the hosted
service is governed by the [Terms of Service](https://app.instantclips.ai/terms).
