#!/usr/bin/env node
// Yatmo MCP server, local stdio edition. Same four read-only tools as the hosted server
// (https://mcp.yatmo.com/mcp/v1), calling the Yatmo REST API with your key (LicenceKey env variable).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync } from "node:fs";
import {
  accessibilityProfile, clamp, errorEnvelope, LIMITS, locationSummary, nearbyPois, nearestByCategory,
  validateCategories, validateCategory, validateCommon,
} from "./core.js";
import { getSummary } from "./yatmo-api.js";

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

const server = new McpServer(
  { name: "yatmo", title: "Yatmo neighbourhood data for real estate", version },
  { instructions: "Neighbourhood data around a property in 25 countries (BE, FR, NL, LU, DE, CH, ES, IT, PT, UK, IE, AT, CA, GR, MA, AU, HR, MT, SI, RS, CY, BA, ME, BG, AL). Pass the property coordinates, the country of the property and the answer language. Distances are network distances with the travel mode they were measured with." },
);

const latitude = z.number().min(-90).max(90).describe("Latitude, -90..90");
const longitude = z.number().min(-180).max(180).describe("Longitude, -180..180");
const language = z.string().describe("Language code, e.g. fr, en, nl, de");
const country = z.string().describe("Country code (market), e.g. BE, FR, NL");
const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };

/** Runs a tool: validation, upstream call, mapping; errors become the same JSON envelope as the hosted server. */
async function run(args, map) {
  let common;
  try {
    common = validateCommon(args);
    const src = await getSummary(common);
    return { content: [{ type: "text", text: JSON.stringify(map(src, common)) }] };
  } catch (err) {
    return { isError: true, content: [{ type: "text", text: JSON.stringify(errorEnvelope(err, args.country, args.language)) }] };
  }
}

server.registerTool("yatmo_get_location_summary", {
  title: "Neighbourhood summary of a property",
  description: "Returns a human-readable neighbourhood summary plus structured facts (nearest school, nearest supermarket, public transport) around a property location. Use this to explain why a property is well situated.",
  inputSchema: { latitude, longitude, language, country },
  annotations: readOnly,
}, (args) => run(args, (src, c) => locationSummary(src, c.language, c.country)));

server.registerTool("yatmo_get_nearby_pois", {
  title: "Points of interest around a property",
  description: "Lists points of interest around a property, optionally filtered by category, within a radius. Categories: school, nursery, supermarket, public_transport, train_station, motorway. 'school' returns actual schools (excluding daycare); 'nursery' returns crèches/daycare only.",
  inputSchema: {
    latitude, longitude, language, country,
    radiusMeters: z.number().int().optional().describe(`Search radius in meters (capped at ${LIMITS.maxRadiusMeters})`),
    categories: z.array(z.string()).optional().describe("Category tokens to keep; empty = all"),
    maxResults: z.number().int().optional().describe(`Maximum POIs to return (capped at ${LIMITS.maxResults})`),
  },
  annotations: readOnly,
}, (args) => run(args, (src, c) => nearbyPois(
  src,
  validateCategories(args.categories),
  clamp(args.radiusMeters, LIMITS.maxRadiusMeters, "radiusMeters"),
  clamp(args.maxResults, LIMITS.maxResults, "maxResults"),
  c.language, c.country,
)));

server.registerTool("yatmo_get_nearest_by_category", {
  title: "Nearest place of a category",
  description: "Returns the single nearest point of interest of a given category (e.g. the nearest school) with distance and travel time. Categories: school, nursery, supermarket, public_transport, train_station, motorway.",
  inputSchema: {
    latitude, longitude,
    category: z.string().describe("Category token, e.g. school, nursery, supermarket, train_station, motorway, public_transport"),
    language, country,
  },
  annotations: readOnly,
}, (args) => run(args, (src, c) => nearestByCategory(src, validateCategory(args.category), String(args.category).trim().toLowerCase(), c.language, c.country)));

server.registerTool("yatmo_get_accessibility_profile", {
  title: "Accessibility profile of a property",
  description: "Returns a synthetic accessibility view of a property: public-transport presence and nearest stop distance. Use it to answer questions like 'is this property practical without a car?'.",
  inputSchema: { latitude, longitude, language, country },
  annotations: readOnly,
}, (args) => run(args, (src, c) => accessibilityProfile(src, c.language, c.country)));

await server.connect(new StdioServerTransport());
