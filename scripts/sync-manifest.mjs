#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";

import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";

const DEFAULT_ENDPOINT = "https://app.instantclips.ai/mcp";
const manifestUrl = new URL("../manifest/instantclips-mcp.json", import.meta.url);
const checkOnly = process.argv.slice(2).includes("--check");
const token = process.env.INSTANTCLIPS_TOKEN?.trim();

if (!token) {
  throw new Error(
    "INSTANTCLIPS_TOKEN is required to refresh the public tool manifest.",
  );
}

const endpoint = new URL(
  process.env.INSTANTCLIPS_MCP_URL || DEFAULT_ENDPOINT,
);
const transport = new StreamableHTTPClientTransport(endpoint, {
  authProvider: { token: async () => token },
});
const client = new Client({
  name: "instantclips-manifest-sync",
  version: "1.0.0",
});

try {
  await client.connect(transport);

  const tools = [];
  let cursor;
  do {
    const page = await client.listTools(cursor ? { cursor } : undefined);
    tools.push(...page.tools);
    cursor = page.nextCursor;
  } while (cursor);

  if (!tools.length) {
    throw new Error("The hosted server returned an empty tool list.");
  }

  const manifest = {
    schemaVersion: 1,
    source: endpoint.href,
    capabilities: client.getServerCapabilities(),
    serverInfo: client.getServerVersion(),
    instructions: client.getInstructions(),
    tools,
  };
  const next = `${JSON.stringify(manifest, null, 2)}\n`;

  if (checkOnly) {
    const current = await readFile(manifestUrl, "utf8");
    if (current !== next) {
      process.stderr.write(
        "The bundled manifest differs from the hosted InstantClips MCP server. Run npm run sync:manifest and commit the result.\n",
      );
      process.exitCode = 1;
    } else {
      process.stdout.write(
        `Manifest is current: ${tools.length} tools from ${manifest.serverInfo?.name || endpoint.hostname}.\n`,
      );
    }
  } else {
    await writeFile(manifestUrl, next);
    process.stdout.write(
      `Updated ${manifestUrl.pathname}: ${tools.length} tools from ${manifest.serverInfo?.name || endpoint.hostname}.\n`,
    );
  }
} finally {
  await client.close().catch(() => {});
}
