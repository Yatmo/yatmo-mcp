"""The Yatmo MCP server over raw HTTP, no library: initialize a session, list the tools, call one.

    export YATMO_KEY=your_backend_key
    python3 quickstart.py

Useful to see what an MCP client exchanges, or as a starting point for an agent built directly on an
LLM SDK. For real clients, use an MCP client library with the Streamable HTTP transport and the
LicenceKey header. https://documentation.yatmo.com/mcp/quick-start
"""
import json
import os
import sys
from urllib.request import Request, urlopen

URL = "https://mcp.yatmo.com/mcp/v1"
KEY = os.environ.get("YATMO_KEY") or sys.exit("set YATMO_KEY to your backend key")


def call(payload, session=None):
    """Posts a JSON-RPC message; returns (parsed result or None, session id)."""
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "LicenceKey": KEY,
    }
    if session:
        headers["Mcp-Session-Id"] = session
    with urlopen(Request(URL, json.dumps(payload).encode(), headers)) as response:
        session = response.headers.get("Mcp-Session-Id", session)
        body = response.read().decode()
    # The answer is a JSON document or a Server-Sent Events stream of "data:" lines.
    for line in body.splitlines():
        if line.startswith("data:"):
            body = line[5:].strip()
            break
    return (json.loads(body) if body.strip() else None), session


result, session = call({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
    "protocolVersion": "2025-06-18",
    "capabilities": {},
    "clientInfo": {"name": "yatmo-quickstart", "version": "1.0"},
}})
print("server:", result["result"]["serverInfo"], "session:", session)

call({"jsonrpc": "2.0", "method": "notifications/initialized"}, session)

result, _ = call({"jsonrpc": "2.0", "id": 2, "method": "tools/list"}, session)
print("tools:", [t["name"] for t in result["result"]["tools"]])

result, _ = call({"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {
    "name": "yatmo_get_location_summary",
    "arguments": {"latitude": 50.846714, "longitude": 4.352514, "language": "en", "country": "BE"},
}}, session)
content = result["result"]["content"][0]["text"]
envelope = json.loads(content)
print("text:", envelope["text"][:300], "...")
print("facts:", json.dumps(envelope["facts"], indent=2)[:600], "...")
