#!/usr/bin/env node

import { readFileSync } from "node:fs";

import {
  Client,
  StreamableHTTPClientTransport,
  UnauthorizedError,
} from "@modelcontextprotocol/client";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";

const DEFAULT_ENDPOINT = "https://app.instantclips.ai/mcp";
const SETTINGS_URL = "https://app.instantclips.ai/settings#ai-access";
const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
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
  INSTANTCLIPS_TOKEN    Required bearer token. Create one at ${SETTINGS_URL}

The upstream endpoint is ${DEFAULT_ENDPOINT}.
`;
}

function configuration(env = process.env) {
  const token = env.INSTANTCLIPS_TOKEN?.trim();
  if (!token) {
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
  return new StreamableHTTPClientTransport(endpoint, {
    authProvider: { token: async () => token },
  });
}

function isRequest(message) {
  return Boolean(
    message &&
      !Array.isArray(message) &&
      typeof message === "object" &&
      typeof message.method === "string" &&
      Object.hasOwn(message, "id"),
  );
}

function isResponse(message) {
  return Boolean(
    message &&
      !Array.isArray(message) &&
      typeof message === "object" &&
      Object.hasOwn(message, "id") &&
      (Object.hasOwn(message, "result") || Object.hasOwn(message, "error")),
  );
}

function safeFailure(error, token) {
  const status = error?.data?.status;
  const text = String(error?.message || error || "Unknown error").replaceAll(
    token,
    "[redacted]",
  );

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

async function startBridge(config) {
  const stdio = new StdioServerTransport();
  const remote = remoteTransport(config);
  const initializeRequestIds = new Set();
  let closing = false;

  const shutdown = async (exitCode = process.exitCode || 0) => {
    if (closing) return;
    closing = true;
    process.exitCode = exitCode;
    process.stdin.off("end", onStdinEnd);
    process.stdin.off("close", onStdinEnd);
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
    await Promise.allSettled([remote.close(), stdio.close()]);
  };

  const onStdinEnd = () => void shutdown();
  const onSigint = () => void shutdown(130);
  const onSigterm = () => void shutdown(143);

  stdio.onmessage = (message) => {
    if (isRequest(message) && message.method === "initialize") {
      initializeRequestIds.add(message.id);
    }

    void remote.send(message).catch(async (error) => {
      if (isRequest(message)) {
        initializeRequestIds.delete(message.id);
        const failure = safeFailure(error, config.token);
        await stdio
          .send({
            jsonrpc: "2.0",
            id: message.id,
            error: {
              code: -32000,
              message: failure.message,
              data: { code: failure.code },
            },
          })
          .catch((sendError) => {
            writeDiagnostic(safeFailure(sendError, config.token));
            void shutdown(74);
          });
      }
    });
  };

  remote.onmessage = (message) => {
    if (isResponse(message) && initializeRequestIds.delete(message.id)) {
      const protocolVersion = message.result?.protocolVersion;
      if (typeof protocolVersion === "string") {
        remote.setProtocolVersion(protocolVersion);
      }
    }
    void stdio.send(message).catch((error) => {
      writeDiagnostic(safeFailure(error, config.token));
      void shutdown(74);
    });
  };

  remote.onerror = (error) => writeDiagnostic(safeFailure(error, config.token));
  remote.onclose = () => void shutdown();
  stdio.onerror = (error) => {
    writeDiagnostic(safeFailure(error, config.token));
    void shutdown(74);
  };
  stdio.onclose = () => void shutdown();

  process.stdin.once("end", onStdinEnd);
  process.stdin.once("close", onStdinEnd);
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);

  await remote.start();
  await stdio.start();
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
    config = configuration();
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
