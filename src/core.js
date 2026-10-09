// Yatmo MCP, local edition: the logic of the hosted server (mcp.yatmo.com) ported to JavaScript.
// Pure functions (no I/O) so they can be unit tested; index.js wires them to the MCP SDK.

export const LIMITS = { maxRadiusMeters: 3000, maxResults: 50, maxTextLength: 6000, timeoutMs: 15000 };

export const LANGUAGES = new Set(["EN", "FR", "NL", "DE", "IT", "PT", "ES", "CA", "ZH", "HI", "AR", "RU", "JA", "EL", "HR", "MT", "SL", "SR", "TR", "BS", "CNR", "SQ", "BG"]);
export const COUNTRIES = new Set(["BE", "FR", "NL", "LU", "DE", "CH", "ES", "IT", "PT", "UK", "IE", "AT", "CA", "GR", "MA", "AU", "HR", "MT", "SI", "RS", "CY", "BA", "ME", "BG", "AL"]);

// Per-country sub-type values (mirrored from the Yatmo country enums): Children nursery, Transports train / motorway.
const NURSERY_ST = { BE: 4, FR: 5, NL: 6, LU: 4, DE: 1, CH: 6, ES: 4, IT: 6, PT: 4, UK: 6, IE: 4, AT: 4, CA: 4, GR: 4, MA: 5, AU: 4, HR: 4, MT: 1, SI: 1, RS: 1, CY: 1, BA: 1, ME: 1, BG: 1, AL: 1 };
const TRAIN_ST = Object.fromEntries([...COUNTRIES].map((c) => [c, c === "FR" ? 5 : 4]));
const MOTORWAY_ST = Object.fromEntries([...COUNTRIES].map((c) => [c, c === "FR" ? 6 : 5]));

const isNursery = (country, st) => NURSERY_ST[country] === st;
const isTrain = (country, st) => TRAIN_ST[country] === st;
const isMotorway = (country, st) => MOTORWAY_ST[country] === st;

/** A category exposed to AI clients: an upstream PoiType (ct) plus an optional sub-type predicate. */
const filter = (name, poiType, matches = () => true) => ({ name, poiType, matches });
export const CATEGORIES = {
  school: filter("school", 1, (c, st) => !isNursery(c, st)),
  nursery: filter("nursery", 1, (c, st) => isNursery(c, st)),
  public_transport: filter("public_transport", 2),
  train_station: filter("train_station", 2, isTrain),
  motorway: filter("motorway", 2, isMotorway),
  supermarket: filter("supermarket", 3),
};
const SYNONYMS = {
  school: "school", schools: "school", education: "school",
  nursery: "nursery", creche: "nursery", daycare: "nursery", childcare: "nursery",
  public_transport: "public_transport", transport: "public_transport", transports: "public_transport",
  train_station: "train_station", train: "train_station", station: "train_station",
  motorway: "motorway", highway: "motorway", motorway_access: "motorway",
  supermarket: "supermarket", shopping: "supermarket", shops: "supermarket",
};
export const CATEGORY_TOKENS = Object.keys(SYNONYMS);
const SUPPORTED_POI_TYPES = new Set([1, 2, 3]);

export class YatmoError extends Error {
  constructor(code, type, message) {
    super(message);
    this.code = code;
    this.type = type;
  }
}
const badRequest = (message) => new YatmoError(400, "bad_request", message);

export function validateCommon({ latitude, longitude, language, country }) {
  if (typeof latitude !== "number" || Number.isNaN(latitude) || latitude < -90 || latitude > 90) throw badRequest("latitude must be between -90 and 90.");
  if (typeof longitude !== "number" || Number.isNaN(longitude) || longitude < -180 || longitude > 180) throw badRequest("longitude must be between -180 and 180.");
  const lang = String(language ?? "").trim().toUpperCase();
  if (!lang) throw badRequest("language is required.");
  if (!LANGUAGES.has(lang)) throw badRequest(`language '${language}' is not supported.`);
  const ctry = String(country ?? "").trim().toUpperCase();
  if (!ctry) throw badRequest("country is required.");
  if (!COUNTRIES.has(ctry)) throw badRequest(`country '${country}' is not supported.`);
  return { latitude, longitude, language: lang, country: ctry };
}

export function validateCategory(token) {
  const key = SYNONYMS[String(token ?? "").trim().toLowerCase()];
  if (!key) throw badRequest(`category is invalid. Allowed: ${[...CATEGORY_TOKENS].sort().join(", ")}.`);
  return CATEGORIES[key];
}

export function validateCategories(tokens) {
  const result = [];
  for (const t of tokens ?? []) {
    const f = validateCategory(t);
    if (!result.includes(f)) result.push(f);
  }
  return result;
}

export function clamp(value, max, name) {
  const v = value ?? max;
  if (v <= 0) throw badRequest(`${name} must be positive.`);
  return Math.min(v, max);
}

export function labelFor(country, poiType, subType) {
  if (poiType === 1) return isNursery(country, subType) ? "nursery" : "school";
  if (poiType === 2) return isTrain(country, subType) ? "train_station" : isMotorway(country, subType) ? "motorway" : "public_transport";
  if (poiType === 3) return "supermarket";
  return "unknown";
}

const MODES = { 1: "driving", 2: "walking", 3: "cycling", 4: "transit" };

/** Shortest NETWORK distance among the place's travel modes, with the time and mode of that entry. */
function bestDistance(place) {
  let best = null;
  for (const t of place.td ?? []) {
    if (!t.hti || !(t.ptdd > 0)) continue;
    if (!best || t.ptdd < best.meters) best = { meters: Math.round(t.ptdd), seconds: Math.round(t.tt ?? 0), mode: t.tm };
  }
  return best;
}

function* places(data) {
  for (const cat of data?.AvailableCategoriesAroundPosition ?? []) {
    for (const sub of cat.sc ?? []) {
      for (const d of sub.d ?? []) yield { ct: cat.ct, st: sub.st, d };
    }
  }
}

function nearestPoi(data, f, country) {
  let best = null;
  for (const { ct, st, d } of places(data)) {
    if (ct !== f.poiType || !f.matches(country, st)) continue;
    const dist = bestDistance(d);
    if (!dist) continue;
    if (!best || dist.meters < best.distanceMeters) {
      best = {
        name: d.n ?? "",
        distanceMeters: dist.meters,
        travelMinutes: dist.seconds > 0 ? Math.round(dist.seconds / 60) : null,
        travelMode: MODES[dist.mode] ?? null,
        latitude: d.la,
        longitude: d.lo,
      };
    }
  }
  return best;
}

function transportFacts(data) {
  let count = 0;
  let nearest = null;
  for (const { ct, d } of places(data)) {
    if (ct !== 2) continue;
    count++;
    const dist = bestDistance(d);
    if (dist && (!nearest || dist.meters < nearest.meters)) nearest = dist;
  }
  return { linesCount: count, nearestStopMeters: nearest?.meters ?? null, nearestStopMode: nearest ? MODES[nearest.mode] ?? null : null };
}

function pick(map, language) {
  if (!map) return "";
  if (map[language]?.trim()) return map[language];
  if (map.EN?.trim()) return map.EN;
  return Object.values(map).find((v) => v?.trim()) ?? "";
}

function flattenParagraph(p, language) {
  let out = "";
  const title = pick(p.Title, language);
  if (title.trim()) out += `${title}: `;
  out += (p.Sentences ?? []).map((s) => pick(s, language)).filter((s) => s.trim()).join(" ");
  for (const item of p.List ?? []) {
    const v = pick(item, language);
    if (v.trim()) out += `\n- ${v}`;
  }
  return out.replace(/\[\/?STRONG\]/g, "").trim();
}

function flattenText(text, language) {
  const paragraphs = text?.Paragraphs ?? [];
  const result = paragraphs.map((p) => flattenParagraph(p, language)).join("\n\n").trim();
  return result.length > LIMITS.maxTextLength ? `${result.slice(0, LIMITS.maxTextLength).trimEnd()}…` : result;
}

const metadata = (country, language) => ({ country, language, generatedAtUtc: new Date().toISOString().replace(/\.\d{3}Z$/, "Z") });
const envelope = (text, facts, country, language) => ({ text, facts, warnings: [], metadata: metadata(country, language) });
const short = (p) => (p ? { name: p.name, distanceMeters: p.distanceMeters, travelMode: p.travelMode } : null);

export function locationSummary(src, language, country) {
  const data = src.Data;
  const t = transportFacts(data);
  const place = data.PlaceInformation;
  return envelope(flattenText(src.Text, language), {
    nearestSchool: short(nearestPoi(data, CATEGORIES.school, country)),
    nearestNursery: short(nearestPoi(data, CATEGORIES.nursery, country)),
    nearestSupermarket: short(nearestPoi(data, CATEGORIES.supermarket, country)),
    transport: { linesCount: t.linesCount, nearestStopDistanceMeters: t.nearestStopMeters, nearestStopTravelMode: t.nearestStopMode },
    place: place ? { street: place.StreetName ?? null, city: place.CityName ?? null, zip: place.ZipCode ?? null } : null,
  }, country, language);
}

export function nearbyPois(src, filters, radiusMeters, maxResults, language, country) {
  const pois = [];
  for (const { ct, st, d } of places(src.Data)) {
    if (!SUPPORTED_POI_TYPES.has(ct)) continue;
    if (filters.length > 0 && !filters.some((f) => f.poiType === ct && f.matches(country, st))) continue;
    const dist = bestDistance(d);
    if (!dist || dist.meters > radiusMeters) continue;
    pois.push({ category: labelFor(country, ct, st), name: d.n ?? "", distanceMeters: dist.meters, travelMode: MODES[dist.mode] ?? null, latitude: d.la, longitude: d.lo });
  }
  const ordered = pois.sort((a, b) => a.distanceMeters - b.distanceMeters).slice(0, maxResults);
  const text = ordered.length === 0
    ? "No matching points of interest were found within the requested radius."
    : `${ordered.length} point(s) of interest found within ${radiusMeters} m.`;
  return envelope(text, { pois: ordered, radiusMeters, totalReturned: ordered.length }, country, language);
}

export function nearestByCategory(src, f, token, language, country) {
  const n = nearestPoi(src.Data, f, country);
  const text = n ? `Nearest ${token}: ${n.name} (${n.distanceMeters} m).` : `No '${token}' was found near this location.`;
  return envelope(text, {
    category: token,
    nearest: n ? { name: n.name, distanceMeters: n.distanceMeters, travelTimeMinutes: n.travelMinutes, travelMode: n.travelMode, latitude: n.latitude, longitude: n.longitude } : null,
  }, country, language);
}

export function accessibilityProfile(src, language, country) {
  const data = src.Data;
  const t = transportFacts(data);
  const train = nearestPoi(data, CATEGORIES.train_station, country);
  const motorway = nearestPoi(data, CATEGORIES.motorway, country);
  const paragraphs = src.Text?.Paragraphs ?? [];
  const para = paragraphs.find((p) => p.IconId?.toLowerCase() === "transport") ?? paragraphs.find((p) => p.IconId?.toLowerCase() === "publictransport");
  const text = para
    ? flattenParagraph(para, language)
    : t.linesCount > 0 && t.nearestStopMeters !== null
      ? `This location has ${t.linesCount} nearby public-transport point(s), closest at ${t.nearestStopMeters} m.`
      : "Limited public-transport information is available for this location.";
  return envelope(text, {
    publicTransportLinesCount: t.linesCount,
    nearestPublicTransportStopDistanceMeters: t.nearestStopMeters,
    nearestPublicTransportStopTravelMode: t.nearestStopMode,
    nearestTrainStationDistanceMeters: train?.distanceMeters ?? null,
    nearestMotorwayAccessDistanceMeters: motorway?.distanceMeters ?? null,
    nearestTrainStation: train ? { name: train.name, distanceMeters: train.distanceMeters, travelMode: train.travelMode } : null,
    nearestMotorwayAccess: motorway ? { name: motorway.name, distanceMeters: motorway.distanceMeters, travelMode: motorway.travelMode } : null,
  }, country, language);
}

export function errorEnvelope(err, country, language) {
  const code = err instanceof YatmoError ? err.code : 500;
  const type = err instanceof YatmoError ? err.type : "internal_error";
  const message = err instanceof YatmoError ? err.message : "An internal error occurred.";
  return { text: message, facts: {}, warnings: [], metadata: metadata(String(country ?? "").toUpperCase(), String(language ?? "").toUpperCase()), error: { code, type, message } };
}
