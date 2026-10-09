// Calls the Yatmo REST API (https://<country>.yatmo.com/Summary/text-and-data) with the user's key,
// keeps answers 60 minutes in memory, and maps HTTP errors to safe, typed errors.
import { LIMITS, YatmoError } from "./core.js";

const cache = new Map();
const CACHE_MS = 60 * 60 * 1000;

export function licenceKey(env = process.env) {
  return (env.LicenceKey || env.YATMO_LICENCE_KEY || env.YATMO_KEY || "").trim();
}

export async function getSummary({ latitude, longitude, language, country }, { key = licenceKey(), fetchImpl = fetch, baseUrlTemplate = process.env.YATMO_BASE_URL || "https://{country}.yatmo.com" } = {}) {
  if (!key) throw new YatmoError(401, "unauthorized", "Missing Yatmo key: set the LicenceKey environment variable (get a key at https://yatmo.com).");

  const cacheKey = `${country}:${language}:${latitude.toFixed(5)}:${longitude.toFixed(5)}`;
  const hit = cache.get(cacheKey);
  if (hit && hit.expires > Date.now()) return hit.value;

  const base = baseUrlTemplate.replace("{country}", country.toLowerCase()).replace(/\/$/, "");
  const url = `${base}/Summary/text-and-data?latitude=${latitude}&longitude=${longitude}&language=${encodeURIComponent(language)}`;

  let response;
  try {
    response = await fetchImpl(url, {
      headers: { LicenceKey: key, Accept: "application/json", "X-Yatmo-SDK": "yatmo-mcp-local" },
      signal: AbortSignal.timeout(LIMITS.timeoutMs),
    });
  } catch (e) {
    throw new YatmoError(500, "internal_error", e?.name === "TimeoutError" ? "Upstream request timed out." : "Upstream service is unreachable.");
  }

  if (!response.ok) throw await mapError(response, country);

  let body;
  try {
    body = await response.json();
  } catch {
    throw new YatmoError(500, "internal_error", "Could not parse the upstream response.");
  }
  if (!body?.Data) throw new YatmoError(500, "internal_error", "Upstream returned an unexpected payload.");

  cache.set(cacheKey, { value: body, expires: Date.now() + CACHE_MS });
  return body;
}

async function mapError(response, country) {
  let upstream = null;
  try {
    const json = JSON.parse(await response.text());
    if (typeof json?.Error === "string" && json.Error.trim()) upstream = json.Error.slice(0, 300);
  } catch {
    // body is not JSON: keep the generic message
  }
  switch (response.status) {
    case 401: return new YatmoError(401, "unauthorized", upstream ?? "LicenceKey is missing or unknown.");
    case 403: return new YatmoError(403, "forbidden", upstream ?? `This licence is not authorized for country '${country}' or the Summary feature.`);
    case 429: return new YatmoError(429, "too_many_requests", "Quota or rate limit exceeded.");
    case 400: return new YatmoError(400, "bad_request", upstream ?? "The location is invalid or outside the country borders.");
    default:
      if (upstream && /authorized to access/i.test(upstream)) return new YatmoError(403, "forbidden", upstream);
      return new YatmoError(500, "internal_error", "An internal error occurred.");
  }
}
