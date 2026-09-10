import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const repositoryRoot = new URL("../", import.meta.url);
const cli = new URL("../bin/instantclips-mcp.js", import.meta.url);

async function mockMcpServer({ rejectToken = false } = {}) {
  const requests = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const raw = Buffer.concat(chunks).toString("latin1");
    if (/^\/mcp\/products(\/[^/]+\/images)?$/.test(request.url)) {
      requests.push({ method: request.method, headers: request.headers, url: request.url, body: raw, upload: true });
      if (request.headers.authorization !== "Bearer test-token") {
        response.writeHead(401, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }
      response.writeHead(request.url === "/mcp/products" ? 201 : 200, { "content-type": "application/json" });
      response.end(JSON.stringify({ product_id: "p-1", import_status: "imported", images: [{ image_id: "i-1", usable: true }] }));
      return;
    }
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

test("serves initialization and the bundled tool manifest without contacting upstream", async (t) => {
  const mock = await mockMcpServer({ rejectToken: true });
  t.after(mock.close);
  const run = runCli([], {
    INSTANTCLIPS_MCP_URL: mock.url,
    INSTANTCLIPS_TOKEN: "placeholder-token",
  });
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
  assert.equal(initialized.result.serverInfo.name, "instantclips");
  assert.equal(initialized.result.serverInfo.version, "0.6.0");
  assert.deepEqual(initialized.result.capabilities, { tools: {} });
  assert.match(initialized.result.instructions, /generate_video/);

  run.child.stdin.write(
    `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
  );
  run.child.stdin.write(
    `${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })}\n`,
  );
  const listed = await nextMessage();
  assert.deepEqual(
    listed.result.tools.map((tool) => tool.name),
    [
      "list_brands",
      "list_products",
      "import_product_from_url",
      "create_product_from_images",
      "get_product",
      "create_brand",
      "set_product_brand",
      "update_brand",
      "update_product",
      "update_video_direction",
      "redraft_video_direction",
      "generate_video",
      "get_video",
    ],
  );

  const fromImages = listed.result.tools.find((tool) => tool.name === "create_product_from_images");
  assert.deepEqual(fromImages.inputSchema.required, ["name"]);
  assert.equal(fromImages.inputSchema.properties.image_paths.type, "array");
  assert.match(fromImages.description, /image_paths/);
  // The hosted server's attachment parameters (ChatGPT's file inputs) are
  // not served here: a stdio client has nothing to put in them.
  assert.equal(fromImages.inputSchema.properties.image_files, undefined);
  assert.equal(fromImages._meta, undefined);
  const updateProduct = listed.result.tools.find((tool) => tool.name === "update_product");
  assert.equal(updateProduct.inputSchema.properties.add_image_paths.type, "array");
  assert.equal(updateProduct.inputSchema.properties.add_image_files, undefined);
  assert.equal(updateProduct._meta, undefined);
  assert.equal(updateProduct.inputSchema.properties.add_image_urls.type, "array", "the hosted-URL parameter stays");
  run.child.stdin.write(
    `${JSON.stringify({ jsonrpc: "2.0", id: 3, method: "ping", params: {} })}\n`,
  );
  const pinged = await nextMessage();
  assert.deepEqual(pinged.result, {});

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(mock.requests, []);

  run.child.stdin.end();
  assert.deepEqual(await run.exited, { code: 0, signal: null });
  assert.equal(run.output().stderr, "");
});

test("proxies tool calls to the hosted server after local discovery", async (t) => {
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
  await nextMessage();
  run.child.stdin.write(
    `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
  );
  run.child.stdin.write(
    `${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })}\n`,
  );
  await nextMessage();
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
  assert.equal(
    mock.requests.some((request) => request.message?.method === "tools/list"),
    false,
  );
  assert.equal(
    mock.requests.some((request) => request.message?.method === "tools/call"),
    true,
  );
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
  await nextMessage();
  run.child.stdin.write(
    `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
  );
  run.child.stdin.write(
    `${JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "list_brands", arguments: {} },
    })}\n`,
  );

  const response = await nextMessage();
  assert.equal(response.id, 2);
  assert.equal(response.result.isError, true);
  assert.match(response.result.content[0].text, /authentication failed/i);
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

test("allows offline discovery when the token is missing and rejects only tool calls", async (t) => {
  const run = runCli([], { INSTANTCLIPS_TOKEN: "" });
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
  assert.equal((await nextMessage()).result.serverInfo.name, "instantclips");
  run.child.stdin.write(
    `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
  );
  run.child.stdin.write(
    `${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })}\n`,
  );
  assert.equal((await nextMessage()).result.tools.length, 13);
  run.child.stdin.write(
    `${JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "list_brands", arguments: {} },
    })}\n`,
  );
  const called = await nextMessage();
  assert.equal(called.result.isError, true);
  assert.match(called.result.content[0].text, /required for tool calls/);

  run.child.stdin.end();
  assert.deepEqual(await run.exited, { code: 0, signal: null });
  assert.equal(run.output().stderr, "");
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
  const manifest = JSON.parse(
    await readFile(
      new URL("../manifest/instantclips-mcp.json", import.meta.url),
      "utf8",
    ),
  );

  assert.equal(packageJson.mcpName, "ai.instantclips/instantclips");
  assert.equal(packageJson.mcpName, serverJson.name);
  assert.equal(serverJson.version, "1.5.0");
  assert.equal(serverJson.remotes.length, 1);
  assert.equal(serverJson.packages.length, 1);
  assert.equal(serverJson.packages[0].identifier, packageJson.name);
  assert.equal(serverJson.packages[0].version, packageJson.version);
  assert.equal(serverJson.packages[0].transport.type, "stdio");
  assert.equal(manifest.serverInfo.name, "instantclips");
  assert.equal(manifest.tools.length, 13);
  assert.equal(
    new Set(manifest.tools.map((tool) => tool.name)).size,
    manifest.tools.length,
  );
  assert.ok(
    manifest.tools.every(
      (tool) => tool.description && tool.inputSchema?.type === "object",
    ),
  );
  const generate = manifest.tools.find((tool) => tool.name === "generate_video");
  assert.equal(generate.annotations.readOnlyHint, false);
  assert.equal(generate.annotations.idempotentHint, false);
  assert.match(generate.description, /SPENDS THE USER'S CREDITS/);
});

async function startedBridge(t, mock) {
  const run = runCli([], { INSTANTCLIPS_MCP_URL: mock.url });
  t.after(() => run.child.kill());
  const nextMessage = jsonLineReader(run.child.stdout);
  run.child.stdin.write(
    `${JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test-client", version: "1.0.0" } },
    })}\n`,
  );
  await nextMessage();
  run.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  return { run, nextMessage };
}

test("uploads photos from this machine as multipart, never as URLs", async (t) => {
  const mock = await mockMcpServer();
  t.after(mock.close);
  const dir = await mkdtemp(join(tmpdir(), "instantclips-mcp-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const photo = join(dir, "mug front.png");
  await writeFile(photo, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]));
  const { run, nextMessage } = await startedBridge(t, mock);
  run.child.stdin.write(
    `${JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "create_product_from_images", arguments: { name: "Enamel Mug", brand_id: "b-1", image_paths: [photo] } },
    })}\n`,
  );
  const created = await nextMessage();
  assert.equal(created.result.isError, false);
  assert.equal(JSON.parse(created.result.content[0].text).product_id, "p-1");
  const upload = mock.requests.find((request) => request.upload);
  assert.equal(upload.url, "/mcp/products");
  assert.equal(upload.headers.authorization, "Bearer test-token");
  assert.match(upload.headers["content-type"], /^multipart\/form-data/);
  assert.match(upload.body, /name="images\[\]"; filename="mug front.png"/);
  assert.match(upload.body, /name="name"\r\n\r\nEnamel Mug/);
  assert.match(upload.body, /name="brand_id"\r\n\r\nb-1/);
  assert.equal(mock.requests.some((request) => request.message?.method === "tools/call"), false);

  run.child.stdin.write(
    `${JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "update_product", arguments: { product_id: "p-1", add_image_paths: [photo] } },
    })}\n`,
  );
  const added = await nextMessage();
  assert.equal(added.result.isError, false);
  assert.equal(mock.requests.filter((request) => request.upload).at(-1).url, "/mcp/products/p-1/images");
  run.child.stdin.end();
  assert.deepEqual(await run.exited, { code: 0, signal: null });
});

test("refuses a missing file, a non-image, image_paths mixed with hosted URLs, and add_image_paths mixed with other fields, without contacting upstream", async (t) => {
  const mock = await mockMcpServer();
  t.after(mock.close);
  const { run, nextMessage } = await startedBridge(t, mock);
  const call = async (id, args, name = "create_product_from_images") => {
    run.child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } })}\n`,
    );
    return nextMessage();
  };
  const missing = await call(2, { name: "Mug", image_paths: ["/nowhere/mug.png"] });
  assert.equal(missing.result.isError, true);
  assert.match(missing.result.content[0].text, /no such file/);
  const notImage = await call(3, { name: "Mug", image_paths: [new URL("../package.json", import.meta.url).pathname] });
  assert.equal(notImage.result.isError, true);
  assert.match(notImage.result.content[0].text, /not an image/);
  const mixed = await call(4, { product_id: "p-1", name: "New name", add_image_paths: ["/nowhere/mug.png"] }, "update_product");
  assert.equal(mixed.result.isError, true);
  assert.match(mixed.result.content[0].text, /separate update_product call/);
  // 1.4.0 uploaded the files and silently dropped the URLs.
  const both = await call(5, { name: "Mug", image_paths: ["/nowhere/mug.png"], image_urls: ["https://cdn.example.com/mug.jpg"] });
  assert.equal(both.result.isError, true);
  assert.match(both.result.content[0].text, /image_paths alone/);
  assert.deepEqual(mock.requests, []);
  run.child.stdin.end();
  assert.deepEqual(await run.exited, { code: 0, signal: null });
});
