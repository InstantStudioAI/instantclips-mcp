import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const repositoryRoot = new URL("../", import.meta.url);
const cli = new URL("../bin/instantclips-mcp.js", import.meta.url);

async function mockMcpServer({ rejectToken = false } = {}) {
  const requests = [];
  const server = createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const message = raw ? JSON.parse(raw) : undefined;
    requests.push({
      method: request.method,
      headers: request.headers,
      message,
    });

    if (request.headers.authorization !== "Bearer test-token" || rejectToken) {
      response.writeHead(401, { "www-authenticate": "Bearer" });
      response.end("Unauthorized");
      return;
    }

    if (request.method === "GET") {
      response.writeHead(405);
      response.end();
      return;
    }

    if (!message || !Object.hasOwn(message, "id")) {
      response.writeHead(202);
      response.end();
      return;
    }

    let result;
    if (message.method === "initialize") {
      result = {
        protocolVersion: message.params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: "instantclips-test", version: "9.9.9" },
      };
    } else if (message.method === "tools/list") {
      result = {
        tools: [
          {
            name: "list_brands",
            description: "List the account's brands.",
            inputSchema: { type: "object", properties: {} },
          },
          {
            name: "generate_video",
            description: "Render an approved video direction.",
            inputSchema: { type: "object", properties: {} },
          },
        ],
      };
    } else if (message.method === "tools/call") {
      result = {
        content: [{ type: "text", text: `called ${message.params.name}` }],
      };
    } else {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          error: { code: -32601, message: "Method not found" },
        }),
      );
      return;
    }

    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();

  return {
    requests,
    url: `http://127.0.0.1:${address.port}/mcp`,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

function runCli(args, env = {}) {
  const child = spawn(process.execPath, [cli.pathname, ...args], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      INSTANTCLIPS_TOKEN: "test-token",
      ...env,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));

  return {
    child,
    output: () => ({ stdout, stderr }),
    exited: once(child, "exit").then(([code, signal]) => ({ code, signal })),
  };
}

function jsonLineReader(stream) {
  stream.setEncoding("utf8");
  let buffer = "";
  const queue = [];
  const waiters = [];

  stream.on("data", (chunk) => {
    buffer += chunk;
    while (buffer.includes("\n")) {
      const newline = buffer.indexOf("\n");
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      const value = JSON.parse(line);
      const waiter = waiters.shift();
      if (waiter) waiter.resolve(value);
      else queue.push(value);
    }
  });

  return () => {
    if (queue.length) return Promise.resolve(queue.shift());
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timed out waiting for JSON-RPC output")), 3000);
      waiters.push({
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
      });
    });
  };
}

test("proxies stdio requests to Streamable HTTP without changing the tool surface", async (t) => {
  const mock = await mockMcpServer();
  t.after(mock.close);
  const run = runCli([], { INSTANTCLIPS_MCP_URL: mock.url });
  t.after(() => run.child.kill());
  const nextMessage = jsonLineReader(run.child.stdout);

  run.child.stdin.write(
    `${JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test-client", version: "1.0.0" },
      },
    })}\n`,
  );
  const initialized = await nextMessage();
  assert.equal(initialized.id, 1);
  assert.equal(initialized.result.serverInfo.name, "instantclips-test");

  run.child.stdin.write(
    `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
  );
  run.child.stdin.write(
    `${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })}\n`,
  );
  const listed = await nextMessage();
  assert.deepEqual(
    listed.result.tools.map((tool) => tool.name),
    ["list_brands", "generate_video"],
  );

  run.child.stdin.write(
    `${JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "list_brands", arguments: {} },
    })}\n`,
  );
  const called = await nextMessage();
  assert.equal(called.result.content[0].text, "called list_brands");

  run.child.stdin.end();
  assert.deepEqual(await run.exited, { code: 0, signal: null });
  assert.equal(run.output().stderr, "");
  assert.ok(
    mock.requests.every(
      (request) => request.headers.authorization === "Bearer test-token",
    ),
  );

  const listRequest = mock.requests.find(
    (request) => request.message?.method === "tools/list",
  );
  assert.equal(listRequest.headers["mcp-protocol-version"], "2025-06-18");
});

test("returns authentication failures in-band without exposing the token", async (t) => {
  const mock = await mockMcpServer({ rejectToken: true });
  t.after(mock.close);
  const run = runCli([], { INSTANTCLIPS_MCP_URL: mock.url });
  t.after(() => run.child.kill());
  const nextMessage = jsonLineReader(run.child.stdout);

  run.child.stdin.write(
    `${JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test-client", version: "1.0.0" },
      },
    })}\n`,
  );

  const response = await nextMessage();
  assert.equal(response.id, 1);
  assert.equal(response.error.code, -32000);
  assert.equal(response.error.data.code, "authentication_failed");
  assert.doesNotMatch(JSON.stringify(response), /test-token/);

  run.child.stdin.end();
  assert.deepEqual(await run.exited, { code: 0, signal: null });
  assert.doesNotMatch(run.output().stderr, /test-token/);
});

test("reports a machine-readable health check", async (t) => {
  const mock = await mockMcpServer();
  t.after(mock.close);
  const run = runCli(["--check", "--json"], { INSTANTCLIPS_MCP_URL: mock.url });
  const exit = await run.exited;
  const result = JSON.parse(run.output().stdout);

  assert.deepEqual(exit, { code: 0, signal: null });
  assert.equal(run.output().stderr, "");
  assert.equal(result.ok, true);
  assert.equal(result.server.name, "instantclips-test");
  assert.equal(result.toolCount, 2);
  assert.deepEqual(result.tools, ["list_brands", "generate_video"]);
});

test("returns a stable authentication failure from the health check", async (t) => {
  const mock = await mockMcpServer({ rejectToken: true });
  t.after(mock.close);
  const run = runCli(["--check", "--json"], { INSTANTCLIPS_MCP_URL: mock.url });
  const exit = await run.exited;
  const result = JSON.parse(run.output().stdout);

  assert.deepEqual(exit, { code: 77, signal: null });
  assert.deepEqual(result, {
    ok: false,
    code: "authentication_failed",
    message:
      "InstantClips authentication failed. Replace INSTANTCLIPS_TOKEN with a token from https://app.instantclips.ai/settings#ai-access.",
  });
  assert.doesNotMatch(run.output().stderr, /test-token/);
});

test("fails before starting stdio when the token is missing", async () => {
  const run = runCli([], { INSTANTCLIPS_TOKEN: "" });
  const exit = await run.exited;

  assert.deepEqual(exit, { code: 78, signal: null });
  assert.equal(run.output().stdout, "");
  assert.match(run.output().stderr, /INSTANTCLIPS_TOKEN is required/);
});

test("reports missing configuration as JSON when requested", async () => {
  const run = runCli(["--check", "--json"], { INSTANTCLIPS_TOKEN: "" });
  const exit = await run.exited;

  assert.deepEqual(exit, { code: 78, signal: null });
  assert.equal(run.output().stderr, "");
  assert.deepEqual(JSON.parse(run.output().stdout), {
    ok: false,
    code: "missing_token",
    message:
      "INSTANTCLIPS_TOKEN is required. Create a token at https://app.instantclips.ai/settings#ai-access.",
  });
});

test("package and registry identities keep the domain-authenticated namespace", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  const serverJson = JSON.parse(
    await readFile(new URL("../server.json", import.meta.url), "utf8"),
  );

  assert.equal(packageJson.mcpName, "ai.instantclips/instantclips");
  assert.equal(packageJson.mcpName, serverJson.name);
  assert.equal(serverJson.version, "1.1.0");
  assert.equal(serverJson.remotes.length, 1);
  assert.equal(serverJson.packages.length, 1);
  assert.equal(serverJson.packages[0].identifier, packageJson.name);
  assert.equal(serverJson.packages[0].version, packageJson.version);
  assert.equal(serverJson.packages[0].transport.type, "stdio");
});
