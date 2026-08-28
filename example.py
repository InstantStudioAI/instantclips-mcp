#!/usr/bin/env python3
"""A dependency-free MCP client for the InstantClips server.

Python 3.9+, standard library only. There is nothing to install: the server is
hosted at https://app.instantclips.ai/mcp and this script is a client for it.

    export INSTANTCLIPS_TOKEN="your-token"      # app.instantclips.ai/settings#ai-access

    python example.py tools                     # every tool, with its live input schema
    python example.py call list_brands '{}'     # call one tool with JSON arguments

Why there is no scripted end-to-end workflow here: tool parameters are the
server's to define, and a copy of them in this repository would be a second
source of truth that goes stale silently the first time one is renamed. So the
script reads them at runtime instead. `tools` prints the real contract, and
`call` passes your JSON through untouched — neither can drift.

The order to call them in is in the README, and does not change:
import -> poll -> read and steer the direction -> render -> collect.

One warning worth repeating: `generate_video` spends credits from the signed-in
account. Everything up to it is free. This script will not stop you calling it,
so put the confirmation in whatever you build around it.
"""

import json
import os
import sys
import urllib.error
import urllib.request

ENDPOINT = os.environ.get("INSTANTCLIPS_MCP_URL", "https://app.instantclips.ai/mcp")
PROTOCOL_VERSION = "2025-06-18"


class RPCError(RuntimeError):
    """A JSON-RPC error frame, as opposed to a transport failure."""


class Client:
    """One stateless Streamable HTTP connection to an MCP server.

    Stateless means every POST stands alone, so there is no session to keep
    alive and no reconnect logic. The server may answer in either
    `application/json` or `text/event-stream`, and both are read here — a
    client that accepts only the first works until the day a response gets
    large enough to stream.
    """

    def __init__(self, endpoint, token):
        self.endpoint = endpoint
        self.token = token
        self.session_id = None
        self._next_id = 0

    def _post(self, payload, notification=False):
        body = json.dumps(payload).encode("utf-8")
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            "Authorization": "Bearer " + self.token,
            "User-Agent": "instantclips-mcp-example/1.0",
        }
        if self.session_id:
            headers["Mcp-Session-Id"] = self.session_id

        req = urllib.request.Request(self.endpoint, data=body, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                self.session_id = resp.headers.get("Mcp-Session-Id") or self.session_id
                raw = resp.read().decode("utf-8")
                content_type = (resp.headers.get("Content-Type") or "").lower()
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace").strip()
            if e.code == 401:
                raise SystemExit(
                    "401 from the server: the token is missing, expired or not valid.\n"
                    "Mint one at https://app.instantclips.ai/settings#ai-access and export it "
                    "as INSTANTCLIPS_TOKEN.\n" + detail
                )
            raise SystemExit("HTTP %s from %s\n%s" % (e.code, self.endpoint, detail))
        except urllib.error.URLError as e:
            raise SystemExit("could not reach %s: %s" % (self.endpoint, e.reason))

        # A notification has no id and the server answers 202 with no body.
        if notification or not raw.strip():
            return None

        frame = _parse_sse(raw) if "text/event-stream" in content_type else json.loads(raw)
        if isinstance(frame, dict) and "error" in frame:
            err = frame["error"]
            raise RPCError("%s (code %s)" % (err.get("message", "unknown error"), err.get("code")))
        return (frame or {}).get("result")

    def request(self, method, params=None):
        self._next_id += 1
        return self._post({
            "jsonrpc": "2.0",
            "id": self._next_id,
            "method": method,
            "params": params or {},
        })

    def notify(self, method, params=None):
        self._post({"jsonrpc": "2.0", "method": method, "params": params or {}}, notification=True)

    def initialize(self):
        """The MCP handshake: initialize, then say you are ready."""
        result = self.request("initialize", {
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": {"name": "instantclips-mcp-example", "version": "1.0"},
        })
        self.notify("notifications/initialized")
        return result

    def list_tools(self):
        """Every tool, paging until the server stops handing back a cursor."""
        tools, cursor = [], None
        while True:
            result = self.request("tools/list", {"cursor": cursor} if cursor else {})
            tools.extend(result.get("tools", []))
            cursor = result.get("nextCursor")
            if not cursor:
                return tools

    def call_tool(self, name, arguments):
        return self.request("tools/call", {"name": name, "arguments": arguments})


def _parse_sse(raw):
    """Pull the first JSON payload out of an SSE body.

    Streamable HTTP sends one `data:` line per frame; multi-line data fields
    are joined with newlines, per the EventSource spec.
    """
    data = []
    for line in raw.splitlines():
        if line.startswith("data:"):
            data.append(line[5:].lstrip())
        elif not line.strip() and data:
            break
    if not data:
        raise RuntimeError("no data frame in the event stream:\n" + raw[:500])
    return json.loads("\n".join(data))


def _describe_schema(schema):
    """Flatten a JSON Schema's top level into readable parameter lines."""
    props = (schema or {}).get("properties") or {}
    if not props:
        return ["    (no parameters)"]
    required = set((schema or {}).get("required") or [])
    lines = []
    for name, spec in props.items():
        kind = spec.get("type", "any")
        if isinstance(kind, list):
            kind = " | ".join(kind)
        if spec.get("enum"):
            kind = "%s (%s)" % (kind, ", ".join(json.dumps(v) for v in spec["enum"]))
        flag = "required" if name in required else "optional"
        line = "    %-28s %-22s %s" % (name, kind, flag)
        desc = (spec.get("description") or "").strip().replace("\n", " ")
        if desc:
            line += "\n%s%s" % (" " * 6, desc)
        lines.append(line)
    return lines


def _connect():
    token = os.environ.get("INSTANTCLIPS_TOKEN")
    if not token:
        raise SystemExit(
            "set INSTANTCLIPS_TOKEN first — mint a token at\n"
            "https://app.instantclips.ai/settings#ai-access\n\n"
            '    export INSTANTCLIPS_TOKEN="your-token"'
        )
    client = Client(ENDPOINT, token)
    info = client.initialize()
    server = (info or {}).get("serverInfo") or {}
    print("connected to %s %s at %s\n" % (
        server.get("name", "the server"), server.get("version", ""), ENDPOINT,
    ))
    return client


def cmd_tools():
    tools = _connect().list_tools()
    print("%d tools\n" % len(tools))
    for tool in sorted(tools, key=lambda t: t["name"]):
        print(tool["name"])
        description = (tool.get("description") or "").strip()
        if description:
            for line in description.splitlines():
                print("  %s" % line)
        for line in _describe_schema(tool.get("inputSchema")):
            print(line)
        print()


def cmd_call(name, raw_args):
    try:
        arguments = json.loads(raw_args)
    except json.JSONDecodeError as e:
        raise SystemExit("arguments must be a JSON object: %s" % e)
    if not isinstance(arguments, dict):
        raise SystemExit("arguments must be a JSON object, got %s" % type(arguments).__name__)

    result = _connect().call_tool(name, arguments)

    # A tool result is content blocks; text is the common one. structuredContent
    # is there when the tool declares an output schema, and is the half worth
    # parsing if you are chaining calls.
    for block in (result or {}).get("content", []):
        if block.get("type") == "text":
            print(block["text"])
        else:
            print(json.dumps(block, indent=2))
    if (result or {}).get("structuredContent"):
        print("\nstructuredContent:")
        print(json.dumps(result["structuredContent"], indent=2))
    if (result or {}).get("isError"):
        raise SystemExit("\nthe tool reported an error")


def main(argv):
    if len(argv) >= 2 and argv[1] == "tools":
        return cmd_tools()
    if len(argv) == 4 and argv[1] == "call":
        return cmd_call(argv[2], argv[3])
    raise SystemExit(__doc__.strip())


if __name__ == "__main__":
    try:
        main(sys.argv)
    except RPCError as e:
        raise SystemExit("the server rejected the request: %s" % e)
    except KeyboardInterrupt:
        raise SystemExit(130)
