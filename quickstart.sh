#!/usr/bin/env sh
# The Yatmo MCP server with curl: initialize a session, list the tools, call one.
#   export YATMO_KEY=your_backend_key && sh quickstart.sh
# https://documentation.yatmo.com/mcp/quick-start
set -e
: "${YATMO_KEY:?set YATMO_KEY to your backend key}"
URL=https://mcp.yatmo.com/mcp/v1

# 1. Initialize: the session id comes back in the Mcp-Session-Id response header.
SESSION=$(curl -sS -D - -o /dev/null -X POST "$URL" \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' -H "LicenceKey: $YATMO_KEY" \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"yatmo-quickstart","version":"1.0"}}}' \
  | tr -d '\r' | awk 'tolower($1)=="mcp-session-id:" {print $2}')
echo "session: $SESSION"

curl -sS -o /dev/null -X POST "$URL" \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' -H "LicenceKey: $YATMO_KEY" -H "Mcp-Session-Id: $SESSION" \
  --data '{"jsonrpc":"2.0","method":"notifications/initialized"}'

# 2. List the tools.
curl -sS -X POST "$URL" \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' -H "LicenceKey: $YATMO_KEY" -H "Mcp-Session-Id: $SESSION" \
  --data '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
echo

# 3. Call a tool on a Brussels address (Grand-Place area).
curl -sS -X POST "$URL" \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' -H "LicenceKey: $YATMO_KEY" -H "Mcp-Session-Id: $SESSION" \
  --data '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"yatmo_get_location_summary","arguments":{"latitude":50.846714,"longitude":4.352514,"language":"en","country":"BE"}}}'
echo
