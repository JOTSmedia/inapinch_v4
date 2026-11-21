import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { handleRatings, readVisitorId, VISITOR_COOKIE } from "../server/ratings.ts";

const ids = new Set(["bayview", "smathers"]);
const origin = "https://in-a-pinch.example";
const alice = `${VISITOR_COOKIE}=1a111111-1111-4111-8111-111111111111`;
const bob = `${VISITOR_COOKIE}=2b222222-2222-4222-8222-222222222222`;

// Execute the actual endpoint SQL against SQLite; do not simulate upsert behavior.
function database() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE bathroom_ratings (
    place_id TEXT NOT NULL, visitor_id TEXT NOT NULL, rating INTEGER NOT NULL,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    PRIMARY KEY (place_id, visitor_id),
    CHECK (typeof(rating) = 'integer' AND rating BETWEEN 1 AND 5)
  );`);
  const db = {
    prepare(sql) {
      return { sql, values: [], bind(...values) { return { sql, values }; } };
    },
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const results = statements.map(({ sql, values }) => {
          const query = sqlite.prepare(sql);
          // D1 ?NNN bindings correspond to SQLite's numeric named parameters.
          const parameters = Object.fromEntries(values.map((value, i) => [String(i + 1), value]));
          if (/^\s*SELECT/i.test(sql)) return { success: true, results: query.all(parameters), meta: { changes: 0 } };
          const result = query.run(parameters);
          return { success: true, results: [], meta: { changes: Number(result.changes) } };
        });
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return { db, sqlite };
}

function request(method = "GET", payload, cookie = alice, customHeaders = {}, url = origin + "/api/ratings") {
  const headers = { ...(cookie ? { Cookie: cookie } : {}), ...customHeaders };
  if (method !== "GET") {
    headers.Origin ??= origin;
    headers["Content-Type"] ??= "application/json";
  }
  return new Request(url, { method, headers, ...(payload === undefined ? {} : { body: typeof payload === "string" ? payload : JSON.stringify(payload) }) });
}

test("new browser gets an HTTP-only secure UUID cookie and no fabricated ratings", async () => {
  const { db, sqlite } = database();
  const result = await handleRatings(request("GET", undefined, null), db, ids);
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { ratings: {}, myRatings: {} });
  const cookie = result.headers.get("set-cookie");
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /Max-Age=31536000/);
  assert.ok(readVisitorId(cookie));
  assert.match(result.headers.get("cache-control"), /no-store/);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM bathroom_ratings").get().n, 0);
  sqlite.close();
});

test("two anonymous browsers share averages while own votes remain isolated", async () => {
  const { db, sqlite } = database();
  assert.equal((await handleRatings(request("POST", { placeId: "bayview", rating: 5 }), db, ids)).status, 200);
  const second = await handleRatings(request("POST", { placeId: "bayview", rating: 3 }, bob), db, ids);
  assert.deepEqual(await second.json(), { ratings: { bayview: { average: 4, count: 2 } }, myRatings: { bayview: 3 } });
  const first = await handleRatings(request(), db, ids);
  assert.deepEqual(await first.json(), { ratings: { bayview: { average: 4, count: 2 } }, myRatings: { bayview: 5 } });
  sqlite.close();
});

test("an update replaces one vote; rapid changes are limited and identical retries are idempotent", async () => {
  const { db, sqlite } = database();
  await handleRatings(request("POST", { placeId: "bayview", rating: 4 }), db, ids);
  const blocked = await handleRatings(request("POST", { placeId: "bayview", rating: 1 }), db, ids);
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get("retry-after")) > 0);
  assert.equal((await handleRatings(request("POST", { placeId: "bayview", rating: 4 }), db, ids)).status, 200);
  sqlite.exec("UPDATE bathroom_ratings SET updated_at = updated_at - 10001");
  const updated = await handleRatings(request("POST", { placeId: "bayview", rating: 2 }), db, ids);
  assert.deepEqual(await updated.json(), { ratings: { bayview: { average: 2, count: 1 } }, myRatings: { bayview: 2 } });
  sqlite.close();
});

test("withdrawal ignores cooldown, deletes only own vote, and is repeatable", async () => {
  const { db, sqlite } = database();
  await handleRatings(request("POST", { placeId: "bayview", rating: 5 }), db, ids);
  await handleRatings(request("POST", { placeId: "bayview", rating: 3 }, bob), db, ids);
  const removed = await handleRatings(request("DELETE", { placeId: "bayview" }), db, ids);
  assert.deepEqual(await removed.json(), { ratings: { bayview: { average: 3, count: 1 } }, myRatings: {} });
  assert.equal((await handleRatings(request("DELETE", { placeId: "bayview" }), db, ids)).status, 200);
  assert.equal((await handleRatings(request("DELETE", { placeId: "bayview" }, bob), db, ids)).status, 200);
  assert.deepEqual(await (await handleRatings(request(), db, ids)).json(), { ratings: {}, myRatings: {} });
  sqlite.close();
});

test("invalid score, unknown place, and body-supplied visitor identities are rejected without writing", async () => {
  const { db, sqlite } = database();
  for (const payload of [
    { placeId: "bayview", rating: 0 }, { placeId: "bayview", rating: 6 },
    { placeId: "bayview", rating: 2.5 }, { placeId: "bayview", rating: "5" },
    { placeId: "not-a-place", rating: 5 }, { placeId: "bayview", rating: 5, visitorId: "spoof" },
  ]) assert.equal((await handleRatings(request("POST", payload), db, ids)).status, 400);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM bathroom_ratings").get().n, 0);
  sqlite.close();
});

test("writes require same origin, JSON and a small well-formed request", async () => {
  const { db, sqlite } = database();
  const vote = { placeId: "bayview", rating: 5 };
  assert.equal((await handleRatings(request("POST", vote, alice, { Origin: "https://other.example" }), db, ids)).status, 403);
  const noOrigin = request("POST", vote); noOrigin.headers.delete("Origin");
  assert.equal((await handleRatings(noOrigin, db, ids)).status, 403);
  assert.equal((await handleRatings(request("POST", vote, alice, { "Content-Type": "text/plain" }), db, ids)).status, 415);
  assert.equal((await handleRatings(request("POST", "{broken"), db, ids)).status, 400);
  assert.equal((await handleRatings(request("POST", " ".repeat(1025)), db, ids)).status, 413);
  assert.equal((await handleRatings(request("POST", vote, alice, { "Content-Length": "9999" }), db, ids)).status, 413);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM bathroom_ratings").get().n, 0);
  sqlite.close();
});

test("invalid or duplicate UUID cookies cannot select another visitor's ratings", async () => {
  const { db, sqlite } = database();
  await handleRatings(request("POST", { placeId: "bayview", rating: 5 }), db, ids);
  for (const cookie of [`${VISITOR_COOKIE}=not-a-uuid`, alice + "; " + bob]) {
    const response = await handleRatings(request("GET", undefined, cookie), db, ids);
    assert.ok(response.headers.get("set-cookie"));
    assert.deepEqual((await response.json()).myRatings, {});
  }
  assert.equal(readVisitorId(alice), "1a111111-1111-4111-8111-111111111111");
  sqlite.close();
});

test("plain HTTP local development omits Secure and existing visitors retain their cookie", async () => {
  const { db, sqlite } = database();
  const local = await handleRatings(request("GET", undefined, null, {}, "http://localhost:3000/api/ratings"), db, ids);
  assert.doesNotMatch(local.headers.get("set-cookie"), /; Secure/);
  const known = await handleRatings(request(), db, ids);
  assert.equal(known.headers.get("set-cookie"), null);
  sqlite.close();
});

test("SQL rejects out-of-range and non-integral scores even outside the handler", () => {
  const { sqlite } = database();
  const insert = sqlite.prepare("INSERT INTO bathroom_ratings VALUES (?, ?, ?, ?, ?)");
  for (const score of [0, 6, 2.5, "bad"]) assert.throws(() => insert.run("bayview", "test", score, 1, 1));
  sqlite.close();
});

test("removed directory entries are excluded and database errors reveal no internals", async () => {
  const { db, sqlite } = database();
  sqlite.prepare("INSERT INTO bathroom_ratings VALUES (?, ?, ?, ?, ?)").run("retired-place", readVisitorId(alice), 5, 1, 1);
  assert.deepEqual(await (await handleRatings(request(), db, ids)).json(), { ratings: {}, myRatings: {} });
  const unavailable = await handleRatings(request(), undefined, ids);
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), { error: "Ratings are temporarily unavailable. Please try again in a moment.", code: "ratings_unavailable" });
  sqlite.close();
});
