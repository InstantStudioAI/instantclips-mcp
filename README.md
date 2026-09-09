# InstantClips MCP

**English** · [Español](README.es.md) · [简体中文](README.zh-CN.md)

[![M8ven Verified](https://m8ven.ai/badge/mcp/instantclips-mcp-1k56q7?variant=verified)](https://m8ven.ai/mcp/instantclips-mcp-1k56q7)

[InstantClips](https://instantclips.ai) turns an e-commerce product into short-form vertical
video for TikTok, Instagram Reels and Stories. It runs a hosted **MCP server**, so Claude Code,
Codex, Cursor, VS Code, the Claude app, ChatGPT or any other MCP client can do what the web app
does: import a product, draft the plan, and generate the video.

**This is not a text-to-video generator.** InstantClips reads the product page — photos, price,
details — and builds the ad from what is actually there. The plan is written first and shown to
you; the video follows the plan. That is why it is cheap enough to run across a catalogue, and why
the result is the product you sell rather than a guess at it.

Free to start: the welcome credits cover the first video, and there is no card to enter. After
that, one-time credit packs, or an Agency membership for anyone running several brands. See
[pricing](https://instantclips.ai/#pricing).

- **Where it fits.** Beside a scheduler (Postiz, Buffer) that posts what comes back. Beside an
  attribution tool that tells you which hook worked. Instead of an editor when you have a product
  page and no footage.
- **Not for.** Cinematic hero films. A presenter reading your script. Horizontal 4K. Products with
  no page and no photos.
- **Built for.** Shopify sellers, dropshippers, brands and agencies running social for several
  stores at once.

**The product server stays hosted.** This repository contains its connection guide, registry
metadata, example HTTP client and a small open-source stdio adapter for clients that cannot connect
to a remote server directly. The adapter answers initialization, ping and tool discovery from a
generated snapshot, then sends authenticated tool calls to the hosted endpoint. The hosted server
remains the source of truth; the product implementation is not duplicated here.

## Endpoint

|            |                                                                                   |
| ---------- | --------------------------------------------------------------------------------- |
| Endpoint   | `https://app.instantclips.ai/mcp`                                                 |
| Transport  | Streamable HTTP, stateless                                                        |
| Method     | `POST`, JSON-RPC 2.0                                                              |
| Auth       | Sign in when your client asks (OAuth 2.1), or `Authorization: Bearer <token>` for callers with no browser |

Paste one address into your assistant and sign in when it asks. That is the whole setup. The
first time it calls, the server sends you to sign in to InstantClips and approve the assistant;
there are no keys to copy. Every assistant you approve is listed under **Authorized apps** in
settings, where you can disconnect it.

The connection is to your own account: same brands, products, credits and plan limits as the web
app. Signing in creates an account if you do not have one, with credits for the first video.

Opening the endpoint in a browser returns the [setup page](https://app.instantclips.ai/mcp)
rather than a protocol error, with one-click install buttons for Cursor and VS Code.

## Install

Connect to the hosted endpoint directly whenever your client supports Streamable HTTP; it takes
you through sign-in on first use. Use a token and the stdio adapter (under "No browser?" below)
only for scripts and automated runners that cannot open a sign-in page.

### Claude Code

```bash
claude mcp add --transport http instantclips https://app.instantclips.ai/mcp
```

Then run `/mcp` inside Claude Code and choose InstantClips to sign in.

### Codex

Add to `~/.codex/config.toml`, which covers the CLI, the app and the IDE extension together:

```toml
[mcp_servers.instantclips]
url = "https://app.instantclips.ai/mcp"
```

Then run `codex mcp login instantclips` to sign in.

### Cursor and VS Code

One-click install buttons are on the [setup page](https://app.instantclips.ai/mcp). They open
the app, add InstantClips, and sign you in on first use.

### Claude app and ChatGPT

Claude app: add a custom connector with this address and sign in when it asks. ChatGPT on the
web: turn on Developer mode under Settings, Apps, Advanced, then add the address as a connector;
on a Business or Enterprise workspace an admin publishes it as an app for everyone instead. The
ChatGPT desktop app takes the same address under Settings, MCP servers, and shares it with Codex.

### Any other MCP client or agent

OpenClaw, Hermes, or an agent you wrote yourself: point it at the address over Streamable HTTP.
The server announces its sign-in flow the standard way, so a client that follows the spec needs
nothing else. Anything that cannot open a sign-in page uses a token instead, below.

### No browser? Use an access token

Scripts, CI jobs and agents that cannot open a sign-in page authenticate with a long-lived token
instead. Mint one at
**[app.instantclips.ai/settings#ai-access](https://app.instantclips.ai/settings#ai-access)**. It
gives full access to your account, so keep it out of anything you commit.

With a token, the same clients look like this:

```bash
# Claude Code
claude mcp add --transport http instantclips https://app.instantclips.ai/mcp --header "Authorization: Bearer YOUR_TOKEN"
```

```toml
# Codex, in ~/.codex/config.toml
[mcp_servers.instantclips]
url = "https://app.instantclips.ai/mcp"
http_headers = { Authorization = "Bearer YOUR_TOKEN" }
```

To keep the token out of the Codex file, swap the header for `bearer_token_env_var = "INSTANTCLIPS_TOKEN"`
and export it in your shell instead. The Claude app takes a token as a request header on the
connector (request headers are still in beta); ChatGPT connectors sign in through the sign-in flow
rather than a pasted key. Any other client sends an `Authorization: Bearer` header. Nothing on the
wire is InstantClips-specific.

#### Stdio-only clients and headless runners

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

## Starter prompts

Five to begin with. Swap in a link or a product name.

1. "Make a video ad for this product: [URL]"
2. "Import every product on this collection page and draft plans for all of them. Don't generate anything yet."
3. "Show me the plan for [product] and rewrite the hook to lead with the price."
4. "Make three videos for [URL] with three different hooks, so I can test them."
5. "Which of my brands is this product for? Then make the video."

## Tools

The workflow, in order:

1. **Import** — `import_product_from_url` for a store page, or `create_product_from_images` when
   there is no page to read.
2. **Wait for the draft** — poll `get_product` until the import and the plan have finished.
3. **Read and steer it** — the plan comes back as text: hook, content focus, format, execution
   guidelines, restrictions. `update_video_direction` edits it, `redraft_video_direction` asks
   for another angle.
4. **Generate** — `generate_video`, passing `expected_credit_cost`: the cost the user was told, as
   `get_product` reported it. A mismatch is refused without charging.
5. **Collect** — poll `get_video` for the finished MP4 and a public share link.

Another video for the same product is the same flow on that product: editing or redrafting opens the
next video's draft, and `generate_video` with no draft renders another take of the last plan. A
generated video itself cannot be changed. Every `get_product` response carries `next_step`: what to
do now.

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

Importing a product, drafting the plan and editing it are all **free**. `generate_video` is the
only tool that spends credits, and it requires your explicit go-ahead — the tools report the cost
first, and `generate_video` takes that number back as `expected_credit_cost`, refusing a launch whose
cost has changed. An agent cannot quietly run up a bill. See [pricing](https://instantclips.ai/#pricing).

## example.py

A dependency-free MCP client — Python 3.9+, standard library only, no `pip install`. It
authenticates with a token, since a script has no browser to sign in with.

```bash
export INSTANTCLIPS_TOKEN="your-token"

python example.py tools                 # every tool, with its live input schema
python example.py call list_brands '{}' # call one tool with JSON arguments
```

`tools` is the one to run first: it prints the real parameter names and types for every tool, which
is what you need before scripting the workflow above.

## Links

- [instantclips.ai/automate](https://instantclips.ai/automate/) — what the automation is for: a
  real result made from a store page, starter prompts, the tools in order, and the rules. It does
  not repeat the setup; this file and the app's setup page are where that lives.
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

Log in right before publishing — the registry token expires within the hour — and the domain is
verified over HTTP, not DNS: `instantclips.ai/.well-known/mcp-registry-auth` on the marketing site
serves this key's public half (`v=MCPv1; k=ed25519; p=…`), and there is no TXT record, so
`login dns` fails with "no MCP public key found".

```bash
mcp-publisher login http --domain instantclips.ai \
  --private-key "$(openssl pkey -in key.pem -text -noout | awk '/priv:/{f=1;next} /pub:/{f=0} f' | tr -d ' :\n')"
mcp-publisher publish
```

`test/shim.test.js` pins the snapshot's server version and `server.json`'s `version`; a release
moves both.

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
