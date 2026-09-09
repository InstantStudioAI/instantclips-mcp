#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";

import {
  Client,
  StreamableHTTPClientTransport,
  UnauthorizedError,
} from "@modelcontextprotocol/client";
import { Server } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";

const DEFAULT_ENDPOINT = "https://app.instantclips.ai/mcp";
const SETTINGS_URL = "https://app.instantclips.ai/settings#ai-access";
const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const manifest = JSON.parse(
  readFileSync(
    new URL("../manifest/instantclips-mcp.json", import.meta.url),
    "utf8",
  ),
);
const VERSION = packageJson.version;

function usage() {
  return `InstantClips MCP ${VERSION}

Use the hosted InstantClips MCP server from a client that requires stdio.

Usage:
  instantclips-mcp
  instantclips-mcp --check [--json]
  instantclips-mcp --help
  instantclips-mcp --version

Environment:
  INSTANTCLIPS_TOKEN    Bearer token required for tool calls. Create one at ${SETTINGS_URL}

Initialization and tool discovery work offline. Tool calls use ${DEFAULT_ENDPOINT}.
`;
}

function configuration(env = process.env, { requireToken = true } = {}) {
  const token = env.INSTANTCLIPS_TOKEN?.trim();
  if (!token && requireToken) {
    throw new CliError(
      "missing_token",
      `INSTANTCLIPS_TOKEN is required. Create a token at ${SETTINGS_URL}.`,
      78,
    );
  }

  let endpoint;
  try {
    endpoint = new URL(env.INSTANTCLIPS_MCP_URL || DEFAULT_ENDPOINT);
  } catch {
    throw new CliError(
      "invalid_endpoint",
      "The InstantClips MCP endpoint URL is invalid.",
      78,
    );
  }
  const isLoopback = ["localhost", "127.0.0.1", "[::1]"].includes(
    endpoint.hostname,
  );
  if (
    endpoint.protocol !== "https:" &&
    !(endpoint.protocol === "http:" && isLoopback)
  ) {
    throw new CliError(
      "insecure_endpoint",
      "The InstantClips MCP endpoint must use HTTPS (HTTP is allowed only for loopback tests).",
      78,
    );
  }

  return { endpoint, token };
}

function remoteTransport({ endpoint, token }) {
  if (!token) {
    throw new CliError(
      "missing_token",
      `INSTANTCLIPS_TOKEN is required for tool calls. Create a token at ${SETTINGS_URL}.`,
      78,
    );
  }
  return new StreamableHTTPClientTransport(endpoint, {
    authProvider: { token: async () => token },
  });
}

function safeFailure(error, token) {
  if (error instanceof CliError) {
    return { code: error.code, message: error.message };
  }
  const status = error?.data?.status;
  const rawText = String(error?.message || error || "Unknown error");
  const text = token ? rawText.replaceAll(token, "[redacted]") : rawText;

  if (
    error instanceof UnauthorizedError ||
    status === 401 ||
    /\b401\b/.test(text)
  ) {
    return {
      code: "authentication_failed",
      message: `InstantClips authentication failed. Replace INSTANTCLIPS_TOKEN with a token from ${SETTINGS_URL}.`,
    };
  }

  if (
    /fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|network|socket|connect/i.test(text)
  ) {
    return {
      code: "upstream_unavailable",
      message: "The hosted InstantClips MCP endpoint is unavailable.",
    };
  }

  return {
    code: "upstream_error",
    message: `The hosted InstantClips MCP endpoint returned an error: ${text}`,
  };
}

function writeDiagnostic(failure) {
  process.stderr.write(`instantclips-mcp: ${failure.message}\n`);
}

// ---- Photos on this machine ------------------------------------------------
//
// The hosted server cannot read the caller's disk; this adapter runs on it and
// can. So two parameters exist only here: `image_paths` on
// create_product_from_images and `add_image_paths` on update_product. They
// are added to the advertised schemas at serve time and handled before any
// proxying, which keeps the bundled manifest exactly what the hosted server
// serves. The files are read and posted as multipart to the hosted upload
// endpoints under the same bearer — packaged and uploaded, never downloaded
// from anywhere.
const MAX_LOCAL_IMAGES = 9;
const MAX_LOCAL_IMAGE_BYTES = 8 * 1024 * 1024;
const LOCAL_IMAGE_TYPES = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".heic": "image/heic",
  ".heif": "image/heif",
};
const LOCAL_UPLOAD_PARAMETERS = {
  create_product_from_images: {
    name: "image_paths",
    replaces: "image_urls",
    description:
      `Paths to photos on this machine, up to ${MAX_LOCAL_IMAGES}, ${MAX_LOCAL_IMAGE_BYTES / 1024 / 1024} MB each. ` +
      "This adapter uploads the files itself; use it instead of image_urls for local photos.",
    note:
      "Through this adapter, `image_paths` (files on this machine) can replace `image_urls`; the files are uploaded directly.",
  },
  update_product: {
    name: "add_image_paths",
    description:
      `Paths to photos on this machine to add, up to ${MAX_LOCAL_IMAGES}, ${MAX_LOCAL_IMAGE_BYTES / 1024 / 1024} MB each. ` +
      "This adapter uploads the files itself. Send it with product_id alone; other fields go in a separate call.",
    note:
      "Through this adapter, `add_image_paths` (files on this machine) adds photos; the files are uploaded directly.",
  },
};

function withLocalUploads(tools) {
  return tools.map((tool) => {
    const extra = LOCAL_UPLOAD_PARAMETERS[tool.name];
    if (!extra) return tool;
    const schema = tool.inputSchema || { type: "object", properties: {} };
    const properties = {
      ...schema.properties,
      [extra.name]: { type: "array", items: { type: "string" }, description: extra.description },
    };
    const inputSchema = { ...schema, properties };
    if (extra.replaces && Array.isArray(schema.required)) {
      inputSchema.required = schema.required.filter((key) => key !== extra.replaces);
    }
    return { ...tool, description: `${tool.description}\n\n${extra.note}`, inputSchema };
  });
}

function hasPaths(value) {
  return Array.isArray(value) && value.length > 0;
}

// A CliError, so safeFailure relays the message verbatim. Built at call
// time: CliError is declared further down and class declarations do not hoist.
function uploadError(message) {
  return new CliError("upload_failed", message, 1);
}

async function appendLocalImages(form, paths) {
  const list = paths.map((path) => String(path).trim()).filter(Boolean);
  if (list.length === 0) throw uploadError("No image paths were given.");
  if (list.length > MAX_LOCAL_IMAGES) {
    throw uploadError(`At most ${MAX_LOCAL_IMAGES} images per call.`);
  }
  for (const path of list) {
    const type = LOCAL_IMAGE_TYPES[extname(path).toLowerCase()];
    if (!type) {
      throw uploadError(`${path} is not an image type the video model takes (jpg, png, webp, gif, bmp, tiff, heic).`);
    }
    let bytes;
    try {
      bytes = await readFile(path);
    } catch (error) {
      throw uploadError(`${path}: ${error.code === "ENOENT" ? "no such file" : error.message}.`);
    }
    if (bytes.byteLength > MAX_LOCAL_IMAGE_BYTES) {
      throw uploadError(`${path} is larger than ${MAX_LOCAL_IMAGE_BYTES / 1024 / 1024} MB.`);
    }
    form.append("images[]", new Blob([bytes], { type }), basename(path));
  }
}

function uploadsUrl(endpoint, suffix) {
  const base = endpoint.pathname.replace(/\/$/, "");
  return new URL(`${base}/${suffix}`, endpoint);
}

async function uploadForm(config, suffix, form) {
  if (!config.token) {
    throw new CliError(
      "missing_token",
      `INSTANTCLIPS_TOKEN is required for tool calls. Create a token at ${SETTINGS_URL}.`,
      78,
    );
  }
  const response = await fetch(uploadsUrl(config.endpoint, suffix), {
    method: "POST",
    headers: { Authorization: `Bearer ${config.token}` },
    body: form,
  });
  const text = await response.text();
  if (response.status === 401) {
    const error = new Error(`401 ${text}`);
    error.data = { status: 401 };
    throw error;
  }
  return { content: [{ type: "text", text }], isError: !response.ok };
}

// → a tool result when the call is one this adapter answers itself, else null.
async function callLocally(config, params) {
  const args = params.arguments ?? {};
  if (params.name === "create_product_from_images" && hasPaths(args.image_paths)) {
    const form = new FormData();
    for (const key of ["name", "description", "creator_note", "brand_id"]) {
      if (args[key] !== undefined && args[key] !== null && args[key] !== "") form.append(key, String(args[key]));
    }
    await appendLocalImages(form, args.image_paths);
    return uploadForm(config, "products", form);
  }
  if (params.name === "update_product" && hasPaths(args.add_image_paths)) {
    const others = Object.keys(args).filter((key) => !["product_id", "add_image_paths"].includes(key));
    if (!args.product_id) throw uploadError("product_id is required with add_image_paths.");
    if (others.length > 0) {
      throw uploadError(
        `Send add_image_paths with product_id alone; ${others.join(", ")} go in a separate update_product call.`,
      );
    }
    const form = new FormData();
    await appendLocalImages(form, args.add_image_paths);
    return uploadForm(config, `products/${encodeURIComponent(String(args.product_id))}/images`, form);
  }
  return null;
}

async function startBridge(config) {
  const stdio = new StdioServerTransport();
  const server = new Server(manifest.serverInfo, {
    capabilities: manifest.capabilities,
    instructions: manifest.instructions,
  });
  let remoteClient;
  let remoteClientPromise;
  let closing = false;

  const connectRemote = () => {
    if (!remoteClientPromise) {
      remoteClientPromise = (async () => {
        const client = new Client({
          name: "instantclips-mcp-stdio-adapter",
          version: VERSION,
        });
        try {
          await client.connect(remoteTransport(config));
          remoteClient = client;
          return client;
        } catch (error) {
          await client.close().catch(() => {});
          remoteClientPromise = undefined;
          throw error;
        }
      })();
    }
    return remoteClientPromise;
  };

  server.setRequestHandler("tools/list", async () => ({
    tools: withLocalUploads(manifest.tools),
  }));

  server.setRequestHandler("tools/call", async (request) => {
    try {
      const local = await callLocally(config, request.params);
      if (local) return local;
      const client = await connectRemote();
      return await client.callTool(request.params);
    } catch (error) {
      const failure = safeFailure(error, config.token);
      return {
        content: [{ type: "text", text: failure.message }],
        isError: true,
      };
    }
  });

  const shutdown = async (exitCode = process.exitCode || 0) => {
    if (closing) return;
    closing = true;
    process.exitCode = exitCode;
    process.stdin.off("end", onStdinEnd);
    process.stdin.off("close", onStdinEnd);
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
    await Promise.allSettled([remoteClient?.close(), server.close()]);
  };

  const onStdinEnd = () => void shutdown();
  const onSigint = () => void shutdown(130);
  const onSigterm = () => void shutdown(143);
  process.stdin.once("end", onStdinEnd);
  process.stdin.once("close", onStdinEnd);
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);

  await server.connect(stdio);
}

async function checkConnection(config, json) {
  const transport = remoteTransport(config);
  const client = new Client({ name: "instantclips-mcp-check", version: VERSION });

  try {
    await client.connect(transport);
    const tools = [];
    let cursor;
    do {
      const page = await client.listTools(cursor ? { cursor } : undefined);
      tools.push(...page.tools.map((tool) => tool.name));
      cursor = page.nextCursor;
    } while (cursor);

    const server = client.getServerVersion();
    const result = {
      ok: true,
      endpoint: config.endpoint.href,
      protocolVersion: client.getNegotiatedProtocolVersion(),
      server,
      toolCount: tools.length,
      tools,
    };

    if (json) {
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } else {
      process.stdout.write(
        `InstantClips MCP is reachable: ${tools.length} tools from ${server?.name || "the hosted server"}.\n`,
      );
    }
    return 0;
  } catch (error) {
    const failure = safeFailure(error, config.token);
    if (json) {
      process.stdout.write(`${JSON.stringify({ ok: false, ...failure })}\n`);
    } else {
      writeDiagnostic(failure);
    }
    return failure.code === "authentication_failed" ? 77 : 69;
  } finally {
    await client.close().catch(() => {});
  }
}

class CliError extends Error {
  constructor(code, message, exitCode) {
    super(message);
    this.code = code;
    this.exitCode = exitCode;
  }
}

async function main(args) {
  if (args.includes("--help") || args.includes("-h")) {
    if (args.length !== 1) throw new CliError("usage", usage(), 64);
    process.stdout.write(usage());
    return 0;
  }
  if (args.includes("--version") || args.includes("-v")) {
    if (args.length !== 1) throw new CliError("usage", usage(), 64);
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }

  const check = args.includes("--check");
  const json = args.includes("--json");
  const accepted = new Set(["--check", "--json"]);
  if (args.some((arg) => !accepted.has(arg)) || (json && !check)) {
    throw new CliError("usage", usage(), 64);
  }

  let config;
  try {
    config = configuration(process.env, { requireToken: check });
  } catch (error) {
    if (check && json && error instanceof CliError) {
      process.stdout.write(
        `${JSON.stringify({ ok: false, code: error.code, message: error.message })}\n`,
      );
      return error.exitCode;
    }
    throw error;
  }
  if (check) return checkConnection(config, json);
  await startBridge(config);
  return 0;
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  if (error instanceof CliError) {
    process.stderr.write(
      error.code === "usage"
        ? `${error.message}\n`
        : `instantclips-mcp: ${error.message}\n`,
    );
    process.exitCode = error.exitCode;
  } else {
    process.stderr.write(`instantclips-mcp: ${error?.message || error}\n`);
    process.exitCode = 70;
  }
}
