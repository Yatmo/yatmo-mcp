# Yatmo MCP server: neighbourhood data for AI assistants and agents

[![Listed on mcpservers.org](https://mcpservers.org/badge.svg)](https://mcpservers.org/servers/yatmo/yatmo-mcp)

[Yatmo](https://yatmo.com) exposes its neighbourhood intelligence to AI clients through a remote
[MCP](https://modelcontextprotocol.io) server. Connect Claude, Cursor, VS Code or your own agent, and it can answer
"what is around this property?" with real data: nearest school, nursery, supermarket, public transport, train station,
motorway access, distances with travel times, and a quotable summary paragraph, in 25 countries.

This repository holds ready-to-copy client configurations and a dependency-free quick start. The server itself is
operated by Yatmo at `https://mcp.yatmo.com/mcp/v1` (Streamable HTTP). Full documentation:
[documentation.yatmo.com/mcp](https://documentation.yatmo.com/mcp).

## The four tools

| Tool | Returns |
|---|---|
| `yatmo_get_location_summary` | A human-readable neighbourhood paragraph plus the nearest school, nursery, supermarket, transport and the reverse-geocoded place |
| `yatmo_get_nearby_pois` | An ordered list of points of interest around a property, optionally filtered by category, within a radius |
| `yatmo_get_nearest_by_category` | The single nearest place of a category, with distance and travel time |
| `yatmo_get_accessibility_profile` | Public-transport presence, nearest stop, nearest train station, nearest motorway access |

All tools take `latitude`, `longitude`, `country` (BE, FR, UK...) and `language`, and return the same envelope:
`text` (a summary the assistant can quote), `facts` (structured data), `warnings` and `metadata`. Categories use one
vocabulary everywhere: `school`, `nursery`, `supermarket`, `public_transport`, `train_station`, `motorway`.
Details: [tools reference](https://documentation.yatmo.com/mcp/tools).

## Authentication

Every request carries your Yatmo **backend** key in the `LicenceKey` header (`LicenseKey` is accepted too). Keep the
key in the client's secret store, never in a public web page: the key grants access to your Yatmo account. Get a key at
[yatmo.com](https://yatmo.com); [keys explained](https://documentation.yatmo.com/license).

## Connect a client

**Generic remote-MCP configuration** ([configs/mcp.json](configs/mcp.json)), accepted by most clients, sometimes under a
slightly different parent key:

```json
{
  "mcpServers": {
    "yatmo": {
      "url": "https://mcp.yatmo.com/mcp/v1",
      "headers": { "LicenceKey": "YOUR_KEY" }
    }
  }
}
```

**Claude.ai and Claude Desktop**: Settings > Connectors > Add custom connector, URL `https://mcp.yatmo.com/mcp/v1`,
custom header `LicenceKey: YOUR_KEY`. The four tools appear once the connector is enabled.

**Claude Code**:

```bash
claude mcp add --transport http yatmo https://mcp.yatmo.com/mcp/v1 --header "LicenceKey: YOUR_KEY"
```

**Cursor**: copy [configs/cursor/mcp.json](configs/cursor/mcp.json) to `.cursor/mcp.json` in your project (or to
`~/.cursor/mcp.json` for every project).

**VS Code (Copilot agent mode)**: copy [configs/vscode/mcp.json](configs/vscode/mcp.json) to `.vscode/mcp.json`.

**Your own agent** (Anthropic, OpenAI or any LLM SDK): use an MCP client library (TypeScript, Python, .NET, Go) with the
Streamable HTTP transport, add the `LicenceKey` header to the transport, and forward the four tool definitions to the
model. [quickstart.py](quickstart.py) shows the raw protocol without any library.

## Try it from the command line

```bash
export YATMO_KEY=your_backend_key
python3 quickstart.py          # initialize, list the tools, call yatmo_get_location_summary on a Brussels address
sh quickstart.sh               # the same three calls with curl
```

## Prompts that work well

- "What is the neighbourhood like around 50.8467, 4.3525 in Belgium? Answer in French."
- "Nearest primary school and supermarket to this listing, with travel times on foot."
- "Is this address well served by public transport? Nearest train station and motorway access?"
- "List the points of interest within 800 m of the property, schools and supermarkets only."

The assistant answers from the `text` and `facts` of the tools; distances come with the mode they were measured in.

## More

- [Quick start](https://documentation.yatmo.com/mcp/quick-start), [authentication and error codes](https://documentation.yatmo.com/mcp/auth), [FAQ](https://documentation.yatmo.com/mcp/faq)
- The same data for websites: [plugins](https://documentation.yatmo.com/plugins), [WordPress](https://wordpress.org/plugins/yatmo-map/), [Odoo](https://apps.odoo.com/apps/modules/20.0/yatmo_map), [mobile SDKs](https://github.com/Yatmo), [examples](https://github.com/Yatmo/yatmo-examples)

MIT licence for the files of this repository. Yatmo is a paid service for real estate portals, agency networks and developers.

## Directories

The server is published in the [official MCP registry](https://registry.modelcontextprotocol.io) as `com.yatmo/yatmo` (`server.json` in this repository) and submitted to the Docker MCP Catalog, Smithery and mcp.so. In clients that read the registry, search for "yatmo" or "real estate".
