import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const repositoryRoot = new URL("../", import.meta.url);
const script = new URL("../scripts/sync-manifest.mjs", import.meta.url);
const manifest = JSON.parse(
  await readFile(new URL("../manifest/instantclips-mcp.json", import.meta.url), "utf8"),
);

// A server that answers the handshake and tools/list the way the hosted one
// does signed out, from the committed manifest after `edit` has its way.
async function hostedServer({ edit = (m) => m, signInRequired = false } = {}) {
  const served = edit(structuredClone(manifest));
  const authorizations = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    authorizations.push(request.headers.authorization);

    if (signInRequired) {
      response.writeHead(401, { "www-authenticate": "Bearer" });
      response.end("Unauthorized");
      return;
    }
    if (request.method !== "POST") {
      response.writeHead(405);
      response.end();
      return;
    }
    const message = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!Object.hasOwn(message, "id")) {
      response.writeHead(202);
      response.end();
      return;
    }
    const result =
      message.method === "initialize"
        ? {
            protocolVersion: message.params.protocolVersion,
            capabilities: served.capabilities,
            serverInfo: served.serverInfo,
            instructions: served.instructions,
          }
        : { tools: served.tools };
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    authorizations,
    url: `http://127.0.0.1:${server.address().port}/mcp`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function check(url) {
  const child = spawn(process.execPath, [script.pathname, "--check"], {
    cwd: repositoryRoot,
    env: { ...process.env, INSTANTCLIPS_MCP_URL: url, INSTANTCLIPS_TOKEN: "stale-token" },
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const [code] = await once(child, "close");
  return { code, stdout, stderr };
}

test("checks the manifest against the server without sending a token, and names what drifted", async (t) => {
  const same = await hostedServer();
  t.after(same.close);
  const current = await check(same.url);
  assert.equal(current.code, 0, current.stderr);
  assert.match(current.stdout, /Manifest is current: 15 tools/);
  assert.ok(same.authorizations.length > 0);
  assert.deepEqual(same.authorizations.filter(Boolean), []);

  const drifted = await hostedServer({
    edit: (m) => {
      m.serverInfo.version = "0.99.0";
      m.tools.find((tool) => tool.name === "generate_video").description = "Changed.";
      m.tools = m.tools.filter((tool) => tool.name !== "send_feedback");
      return m;
    },
  });
  t.after(drifted.close);
  const behind = await check(drifted.url);
  assert.equal(behind.code, 1);
  assert.match(behind.stderr, new RegExp(`server version ${manifest.serverInfo.version} → 0\\.99\\.0`));
  assert.match(behind.stderr, /removed: send_feedback/);
  assert.match(behind.stderr, /changed: generate_video\n/);
});

test("says so when the server asks for sign-in before listing its tools", async (t) => {
  const closed = await hostedServer({ signInRequired: true });
  t.after(closed.close);
  const refused = await check(closed.url);
  assert.notEqual(refused.code, 0);
  assert.match(refused.stderr, /asked for sign-in before listing its tools/);
});
