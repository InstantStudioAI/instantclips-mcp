#!/usr/bin/env node

// Refreshes manifest/instantclips-mcp.json: the hosted server's handshake and
// tool list, which the adapter serves without contacting it.
//
//   npm run sync:manifest    write the snapshot from the hosted server
//   npm run check:manifest   exit 1, naming what drifted, when they differ
//
// The hosted server answers the handshake and tools/list without signing in,
// so this sends no token and ignores INSTANTCLIPS_TOKEN: a token that no
// longer works gets even the tool list refused. INSTANTCLIPS_MCP_URL reads
// another server, such as a local one at http://localhost:3000/mcp.

import { readFile, writeFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";

import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";

const DEFAULT_ENDPOINT = "https://app.instantclips.ai/mcp";
const manifestUrl = new URL("../manifest/instantclips-mcp.json", import.meta.url);

const endpoint = new URL(process.env.INSTANTCLIPS_MCP_URL || DEFAULT_ENDPOINT);
const checkOnly = process.argv.slice(2).includes("--check");

const live = await readServer(endpoint);
const from = `${live.tools.length} tools, ${live.serverInfo?.name} ${live.serverInfo?.version}, from ${endpoint.href}`;

if (checkOnly) {
  const committed = JSON.parse(await readFile(manifestUrl, "utf8"));
  const drift = describeDrift(committed, live);
  if (drift.length) {
    process.stderr.write(
      [
        `The bundled manifest differs from ${endpoint.href}:`,
        ...drift.map((line) => `  ${line}`),
        "Run npm run sync:manifest and commit the result.",
        "",
      ].join("\n"),
    );
    process.exitCode = 1;
  } else {
    process.stdout.write(`Manifest is current: ${from}.\n`);
  }
} else {
  await writeFile(manifestUrl, `${JSON.stringify(live, null, 2)}\n`);
  process.stdout.write(`Updated manifest/instantclips-mcp.json: ${from}.\n`);
}

// The snapshot, in the shape the adapter reads. The tools come back through
// the client's own parsing, which fixes their key order; vid-tok's
// `bin/rails mcp:surface` mirrors that order to write the same bytes.
async function readServer(url) {
  const client = new Client({
    name: "instantclips-manifest-sync",
    version: "2.0.0",
  });

  try {
    await client.connect(new StreamableHTTPClientTransport(url));

    const tools = [];
    let cursor;
    do {
      const page = await client.listTools(cursor ? { cursor } : undefined);
      tools.push(...page.tools);
      cursor = page.nextCursor;
    } while (cursor);

    if (!tools.length) fail(`${url.href} returned an empty tool list.`);

    return {
      schemaVersion: 1,
      source: url.href,
      capabilities: client.getServerCapabilities(),
      serverInfo: client.getServerVersion(),
      instructions: client.getInstructions(),
      tools,
    };
  } catch (error) {
    if (error?.status === 401) {
      fail(
        `${url.href} asked for sign-in before listing its tools. The hosted server lists them without a token; check INSTANTCLIPS_MCP_URL.`,
      );
    }
    throw error;
  } finally {
    await client.close().catch(() => {});
  }
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

// What a reader of the two files would call different. `source` says where a
// snapshot was read, not what the server serves, so it is left out; key order
// is too, since it changes no client's behaviour.
function describeDrift(committed, live) {
  const lines = [];

  const was = committed.serverInfo?.version;
  const now = live.serverInfo?.version;
  if (was !== now) {
    lines.push(`server version ${was} → ${now}`);
  } else if (!isDeepStrictEqual(committed.serverInfo, live.serverInfo)) {
    lines.push("serverInfo changed");
  }
  if (!isDeepStrictEqual(committed.capabilities, live.capabilities)) {
    lines.push("capabilities changed");
  }
  if (committed.instructions !== live.instructions) {
    lines.push("instructions changed");
  }

  const before = new Map((committed.tools ?? []).map((tool) => [tool.name, tool]));
  const after = new Map(live.tools.map((tool) => [tool.name, tool]));
  const added = [...after.keys()].filter((name) => !before.has(name));
  const removed = [...before.keys()].filter((name) => !after.has(name));
  const changed = [...after.keys()].filter(
    (name) => before.has(name) && !isDeepStrictEqual(before.get(name), after.get(name)),
  );
  if (added.length) lines.push(`added: ${added.join(", ")}`);
  if (removed.length) lines.push(`removed: ${removed.join(", ")}`);
  if (changed.length) lines.push(`changed: ${changed.join(", ")}`);

  const kept = [...before.keys()].filter((name) => after.has(name));
  const keptLive = [...after.keys()].filter((name) => before.has(name));
  if (!isDeepStrictEqual(kept, keptLive)) {
    lines.push("tool order changed");
  }

  return lines;
}
