// Unit tests of the mapping on a real /Summary/text-and-data answer (Rue de la Loi, Brussels, FR).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  accessibilityProfile, CATEGORIES, clamp, errorEnvelope, labelFor, locationSummary, nearbyPois, nearestByCategory,
  validateCategories, validateCategory, validateCommon, YatmoError,
} from "../src/core.js";
import { getSummary } from "../src/yatmo-api.js";

const src = JSON.parse(readFileSync(new URL("./fixtures/brussels-text-and-data.json", import.meta.url), "utf8"));

test("validation normalises and rejects", () => {
  assert.deepEqual(validateCommon({ latitude: 50.8, longitude: 4.3, language: " fr ", country: "be" }), { latitude: 50.8, longitude: 4.3, language: "FR", country: "BE" });
  assert.throws(() => validateCommon({ latitude: 91, longitude: 4, language: "FR", country: "BE" }), /latitude/);
  assert.throws(() => validateCommon({ latitude: 50, longitude: 4, language: "XX", country: "BE" }), /language 'XX'/);
  assert.throws(() => validateCommon({ latitude: 50, longitude: 4, language: "FR", country: "US" }), /country 'US'/);
  assert.equal(validateCategory("Daycare"), CATEGORIES.nursery);
  assert.deepEqual(validateCategories(["school", "schools", "education"]), [CATEGORIES.school]);
  assert.throws(() => validateCategory("pizza"), /Allowed:/);
  assert.equal(clamp(undefined, 3000, "r"), 3000);
  assert.equal(clamp(10000, 3000, "r"), 3000);
  assert.throws(() => clamp(0, 3000, "radiusMeters"), /radiusMeters must be positive/);
});

test("labels follow the per-country sub-types", () => {
  assert.equal(labelFor("BE", 1, 4), "nursery");
  assert.equal(labelFor("BE", 1, 2), "school");
  assert.equal(labelFor("FR", 2, 5), "train_station");
  assert.equal(labelFor("FR", 2, 6), "motorway");
  assert.equal(labelFor("BE", 2, 4), "train_station");
  assert.equal(labelFor("BE", 2, 1), "public_transport");
  assert.equal(labelFor("BE", 3, 1), "supermarket");
});

test("location summary", () => {
  const r = locationSummary(src, "FR", "BE");
  assert.ok(r.text.length > 200, "flattened text");
  assert.ok(!r.text.includes("[STRONG]"), "markers removed");
  assert.ok(r.text.length <= 6001);
  assert.ok(r.facts.nearestSchool.name);
  assert.ok(r.facts.nearestSchool.distanceMeters > 0);
  assert.ok(["driving", "walking", "cycling", "transit"].includes(r.facts.nearestSchool.travelMode));
  assert.ok(r.facts.nearestNursery.name);
  assert.ok(r.facts.nearestSupermarket.name);
  assert.ok(r.facts.transport.linesCount > 0);
  assert.ok(r.facts.transport.nearestStopDistanceMeters > 0);
  assert.deepEqual(Object.keys(r.facts.place), ["street", "city", "zip"]);
  assert.equal(r.metadata.country, "BE");
  assert.equal(r.metadata.language, "FR");
  assert.match(r.metadata.generatedAtUtc, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
});

test("nearby pois: radius, order, filter, cap", () => {
  const all = nearbyPois(src, [], 3000, 50, "FR", "BE");
  assert.ok(all.facts.totalReturned > 3);
  const d = all.facts.pois.map((p) => p.distanceMeters);
  assert.deepEqual(d, [...d].sort((a, b) => a - b), "sorted by distance");
  assert.ok(d.every((m) => m <= 3000));
  const schools = nearbyPois(src, validateCategories(["school"]), 3000, 50, "FR", "BE");
  assert.ok(schools.facts.pois.length > 0);
  assert.ok(schools.facts.pois.every((p) => p.category === "school"));
  assert.equal(nearbyPois(src, [], 3000, 2, "FR", "BE").facts.totalReturned, 2);
  assert.match(nearbyPois(src, [], 1, 50, "FR", "BE").text, /No matching/);
});

test("nearest by category", () => {
  const r = nearestByCategory(src, CATEGORIES.supermarket, "supermarket", "FR", "BE");
  assert.match(r.text, /^Nearest supermarket: .+ \(\d+ m\)\.$/);
  assert.equal(r.facts.category, "supermarket");
  assert.ok(r.facts.nearest.latitude > 50 && r.facts.nearest.longitude > 4);
  assert.ok(r.facts.nearest.travelTimeMinutes >= 0);
});

test("accessibility profile", () => {
  const r = accessibilityProfile(src, "EN", "BE");
  assert.ok(r.text.length > 20);
  assert.ok(r.facts.publicTransportLinesCount > 0);
  assert.ok(r.facts.nearestTrainStation === null || r.facts.nearestTrainStation.distanceMeters > 0);
});

test("errors never leak internals", () => {
  const e = errorEnvelope(new YatmoError(403, "forbidden", "No access to FR."), "fr", "en");
  assert.deepEqual(e.error, { code: 403, type: "forbidden", message: "No access to FR." });
  assert.equal(e.metadata.country, "FR");
  const i = errorEnvelope(new Error("stack secret"), "BE", "FR");
  assert.equal(i.error.code, 500);
  assert.ok(!JSON.stringify(i).includes("secret"));
});

test("api client: missing key, header, error mapping", async () => {
  await assert.rejects(getSummary({ latitude: 50.8, longitude: 4.3, language: "FR", country: "BE" }, { key: "" }), (e) => e.code === 401);
  let seen;
  const ok = async (url, init) => { seen = { url, init }; return new Response(JSON.stringify(src), { status: 200 }); };
  const r = await getSummary({ latitude: 50.81, longitude: 4.31, language: "FR", country: "BE" }, { key: "k1", fetchImpl: ok });
  assert.ok(r.Data);
  assert.equal(seen.url, "https://be.yatmo.com/Summary/text-and-data?latitude=50.81&longitude=4.31&language=FR");
  assert.equal(seen.init.headers.LicenceKey, "k1");
  const denied = async () => new Response(JSON.stringify({ Error: "You are not authorized to access FR" }), { status: 500 });
  await assert.rejects(getSummary({ latitude: 48.85, longitude: 2.35, language: "FR", country: "FR" }, { key: "k1", fetchImpl: denied }), (e) => e.code === 403);
  const limit = async () => new Response("", { status: 429 });
  await assert.rejects(getSummary({ latitude: 48.86, longitude: 2.35, language: "FR", country: "FR" }, { key: "k1", fetchImpl: limit }), (e) => e.code === 429);
});
