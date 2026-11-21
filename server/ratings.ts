/** Anonymous, cookie-scoped ratings. No accounts, IP addresses, or seeded votes. */
export const VISITOR_COOKIE = "inapinch_visitor";
export const RATING_COOLDOWN_MS = 10_000;
export const MAX_RATING_BODY_BYTES = 1_024;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type StatementLike<S> = { bind(...values: unknown[]): S };
type SqlResult = {
  success?: boolean;
  results?: unknown[];
  meta?: { changes?: number };
};

/** A structural subset of Cloudflare D1, also usable by the SQLite test adapter. */
export type RatingsDatabase<S extends StatementLike<S>> = {
  prepare(query: string): S;
  batch(statements: S[]): Promise<SqlResult[]>;
};

export type RatingsSnapshot = {
  ratings: Record<string, { average: number; count: number }>;
  myRatings: Record<string, number>;
};

type AggregateRow = { placeId: string; average: number; count: number };
type OwnRatingRow = { placeId: string; rating: number; updatedAt: number };
type Mutation = { placeId: string; rating?: number };

export class RatingRequestError extends Error {
  status: number;
  code: string;
  retryAfter?: number;

  constructor(status: number, code: string, message: string, retryAfter?: number) {
    super(message);
    this.name = "RatingRequestError";
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

export function readVisitorId(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const matches = cookieHeader.split(";").flatMap((part) => {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== VISITOR_COOKIE) return [];
    return [part.slice(separator + 1).trim()];
  });
  // Ambiguous, malformed, and non-UUID cookies get a fresh server-generated identity.
  return matches.length === 1 && UUID_V4.test(matches[0]) ? matches[0].toLowerCase() : null;
}

export function makeVisitorCookie(visitorId: string, isHttps: boolean): string {
  if (!UUID_V4.test(visitorId)) throw new Error("A valid random UUID is required.");
  return `${VISITOR_COOKIE}=${visitorId.toLowerCase()}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${isHttps ? "; Secure" : ""}`;
}

export function validateRatingMutation(
  method: "POST" | "DELETE",
  input: unknown,
  allowedIds: ReadonlySet<string>,
): Mutation {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new RatingRequestError(400, "invalid_body", "Send a JSON object with the bathroom and rating.");
  }
  const body = input as Record<string, unknown>;
  const acceptedKeys = method === "POST" ? ["placeId", "rating"] : ["placeId"];
  if (Object.keys(body).some((key) => !acceptedKeys.includes(key))) {
    throw new RatingRequestError(400, "unexpected_field", "Only the bathroom ID and rating may be submitted.");
  }
  if (typeof body.placeId !== "string" || !allowedIds.has(body.placeId)) {
    throw new RatingRequestError(400, "unknown_bathroom", "Choose a bathroom from the map.");
  }
  if (method === "POST" && (
    typeof body.rating !== "number" || !Number.isInteger(body.rating) || body.rating < 1 || body.rating > 5
  )) {
    throw new RatingRequestError(400, "invalid_rating", "Choose a whole-star rating from 1 to 5.");
  }
  return method === "POST"
    ? { placeId: body.placeId, rating: body.rating as number }
    : { placeId: body.placeId };
}

/** Keeps obsolete locations and internal visitor identifiers out of API responses. */
export function formatRatingsSnapshot(
  aggregates: AggregateRow[],
  ownRatings: OwnRatingRow[],
  allowedIds: ReadonlySet<string>,
): RatingsSnapshot {
  const ratings: RatingsSnapshot["ratings"] = Object.create(null);
  const myRatings: RatingsSnapshot["myRatings"] = Object.create(null);
  for (const row of aggregates) {
    if (allowedIds.has(row.placeId) && Number.isInteger(row.count) && row.count > 0 &&
        Number.isFinite(row.average) && row.average >= 1 && row.average <= 5) {
      ratings[row.placeId] = { average: row.average, count: row.count };
    }
  }
  for (const row of ownRatings) {
    if (allowedIds.has(row.placeId) && Number.isInteger(row.rating) && row.rating >= 1 && row.rating <= 5) {
      myRatings[row.placeId] = row.rating;
    }
  }
  return { ratings, myRatings };
}

function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("Origin");
  if (origin !== new URL(request.url).origin || request.headers.get("Sec-Fetch-Site") === "cross-site") {
    throw new RatingRequestError(403, "origin_not_allowed", "Submit ratings from this website.");
  }
}

async function readBoundedJson(request: Request): Promise<unknown> {
  const contentType = request.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new RatingRequestError(415, "json_required", "Send the rating as application/json.");
  }
  const contentLength = request.headers.get("Content-Length");
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > MAX_RATING_BODY_BYTES) {
    throw new RatingRequestError(413, "body_too_large", "The rating request is too large.");
  }
  if (!request.body) throw new RatingRequestError(400, "invalid_json", "A JSON request body is required.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_RATING_BODY_BYTES) {
        await reader.cancel();
        throw new RatingRequestError(413, "body_too_large", "The rating request is too large.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new RatingRequestError(400, "invalid_json", "The rating request contains invalid JSON.");
  }
}

function jsonResponse(body: unknown, status = 200, cookie?: string, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(extraHeaders);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "private, no-store");
  headers.set("Vary", "Cookie");
  headers.set("X-Content-Type-Options", "nosniff");
  if (cookie) headers.set("Set-Cookie", cookie);
  return new Response(JSON.stringify(body), { status, headers });
}

/**
 * GET: shared aggregates plus this browser's ratings.
 * POST {placeId,rating}: create or replace one vote for this browser and bathroom.
 * DELETE {placeId}: withdraw this browser's vote, without a cooldown.
 * The schema is migrated before deployment, never created during a request.
 */
export async function handleRatings<S extends StatementLike<S>>(
  request: Request,
  db: RatingsDatabase<S> | undefined,
  allowedPlaceIds: ReadonlySet<string> | readonly string[],
): Promise<Response> {
  let newCookie: string | undefined;
  try {
    const method = request.method.toUpperCase();
    if (method !== "GET" && method !== "POST" && method !== "DELETE") {
      return jsonResponse(
        { error: "Use GET, POST, or DELETE for ratings.", code: "method_not_allowed" },
        405, undefined, { Allow: "GET, POST, DELETE" },
      );
    }
    const allowedIds = new Set(allowedPlaceIds);
    let mutation: Mutation | undefined;
    if (method !== "GET") {
      assertSameOrigin(request);
      mutation = validateRatingMutation(method, await readBoundedJson(request), allowedIds);
    }
    if (!db) throw new Error("Ratings database is unavailable.");

    const existingVisitor = readVisitorId(request.headers.get("Cookie"));
    const visitorId = existingVisitor ?? crypto.randomUUID();
    if (!existingVisitor) newCookie = makeVisitorCookie(visitorId, new URL(request.url).protocol === "https:");

    const allowedJson = JSON.stringify([...allowedIds]);
    const aggregateStatement = db.prepare(`
      SELECT place_id AS placeId, AVG(rating) AS average, COUNT(*) AS count
      FROM bathroom_ratings
      WHERE place_id IN (SELECT value FROM json_each(?1))
      GROUP BY place_id
    `).bind(allowedJson);
    const ownStatement = db.prepare(`
      SELECT place_id AS placeId, rating, updated_at AS updatedAt
      FROM bathroom_ratings
      WHERE visitor_id = ?1 AND place_id IN (SELECT value FROM json_each(?2))
    `).bind(visitorId, allowedJson);

    let statements: S[];
    let snapshotIndex = 0;
    if (method === "POST" && mutation) {
      const now = Date.now();
      // The WHERE clause makes the cooldown atomic, including simultaneous requests.
      const update = db.prepare(`
        INSERT INTO bathroom_ratings (place_id, visitor_id, rating, created_at, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?4)
        ON CONFLICT(place_id, visitor_id) DO UPDATE SET
          rating = excluded.rating,
          updated_at = excluded.updated_at
        WHERE bathroom_ratings.updated_at <= ?5
      `).bind(mutation.placeId, visitorId, mutation.rating, now, now - RATING_COOLDOWN_MS);
      statements = [update, aggregateStatement, ownStatement];
      snapshotIndex = 1;
    } else if (method === "DELETE" && mutation) {
      const remove = db.prepare("DELETE FROM bathroom_ratings WHERE place_id = ?1 AND visitor_id = ?2")
        .bind(mutation.placeId, visitorId);
      statements = [remove, aggregateStatement, ownStatement];
      snapshotIndex = 1;
    } else {
      statements = [aggregateStatement, ownStatement];
    }

    // D1 batches execute as a transaction: the response reflects this write's state.
    const results = await db.batch(statements);
    if (results.length !== statements.length || results.some((result) => result.success === false)) {
      throw new Error("Ratings database request failed.");
    }
    const aggregates = (results[snapshotIndex].results ?? []) as AggregateRow[];
    const ownRatings = (results[snapshotIndex + 1].results ?? []) as OwnRatingRow[];
    if (method === "POST" && mutation && results[0].meta?.changes === 0) {
      const current = ownRatings.find((row) => row.placeId === mutation.placeId);
      // An identical retry succeeds without creating a vote or resetting the cooldown.
      if (current && current.rating !== mutation.rating) {
        const wait = Math.max(1, Math.ceil((current.updatedAt + RATING_COOLDOWN_MS - Date.now()) / 1000));
        throw new RatingRequestError(429, "rating_cooldown", `Please wait ${wait} seconds before changing this rating.`, wait);
      }
    }
    return jsonResponse(formatRatingsSnapshot(aggregates, ownRatings, allowedIds), 200, newCookie);
  } catch (error) {
    if (error instanceof RatingRequestError) {
      const headers = error.retryAfter ? { "Retry-After": String(error.retryAfter) } : undefined;
      return jsonResponse({ error: error.message, code: error.code }, error.status, newCookie, headers);
    }
    // Do not expose SQL, visitor identifiers, or runtime configuration in errors.
    return jsonResponse(
      { error: "Ratings are temporarily unavailable. Please try again in a moment.", code: "ratings_unavailable" },
      503, newCookie,
    );
  }
}
