import { Readable } from "node:stream";
import { HTTPException } from "hono/http-exception";
import type { MiddlewareHandler } from "hono";
import { prisma } from "~/server/db";
import { requireProjectPermission } from "~/server/auth/permissions";
import { rateLimit } from "~/server/rateLimit";
import {
  resolveStoredObjectOwner,
  StoredObjectOwnerLookupUnavailableError,
} from "~/server/stored-objects/stored-objects-cross-tenant-lookup";
import { createStoredObjectsService } from "~/server/stored-objects/stored-objects-factory";
import { isReadbackSafe } from "~/server/stored-objects/safe-media-types";
import { dualAuth } from "../../middleware/dual-auth";
import type { DualAuthVariables } from "../../middleware/dual-auth";
import { anyAuthenticated, createServiceApp } from "~/server/api/security";

// File reads authenticate via dualAuth (project API key OR user session) and
// authorize per-object in the handler (authorizeFileRead checks the caller's
// project against the object owner). The policy is anyAuthenticated() with
// dualAuth as the verifier; cross-tenant access is denied in-handler.
const secured = createServiceApp<{ Variables: DualAuthVariables }>({
  basePath: "/api/files",
  verifySecret: dualAuth,
});

/**
 * Resolves the Content-Type header for a stored-object response.
 *
 * Returns the requested mediaType when it is in the shared SAFE_MEDIA_TYPES
 * allowlist (see `safe-media-types.ts`). Anything else is coerced to
 * application/octet-stream to neutralize MIME sniffing and stored-XSS
 * primitives (an attacker can't trick a browser into interpreting their
 * payload as text/html or application/javascript).
 *
 * The allowlist is the single source of truth shared with the ingest-path
 * extractor — widen it in safe-media-types.ts and both surfaces update.
 */
function safeMediaType(mediaType: string): string {
  return isReadbackSafe(mediaType) ? mediaType : "application/octet-stream";
}

function sanitizeFilenameSegment(id: string): string {
  // RFC 6266 — keep ASCII, replace anything else with _; quote with double quotes.
  return id.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 128);
}

/**
 * Per-project rate limit on the read endpoint.
 *
 * 120 requests / minute / project covers the realistic in-app render
 * cases (~10 media parts in flight at a time) with headroom, and caps
 * scraper abuse from one tenant's credentials at 2 req/s. Tuneable per
 * project when AC12 lands proper per-tenant overrides.
 */
const FILES_RATE_LIMIT_WINDOW_SECONDS = 60;
const FILES_RATE_LIMIT_MAX = 120;

/**
 * Common headers we attach to every files-route response. Static — never
 * vary by row, never echo user content. See AC9 + AC11 + the
 * security-reviewer pass on PR #4058.
 */
const FILES_RESPONSE_BASE_HEADERS: Readonly<Record<string, string>> = {
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; sandbox",
  "Referrer-Policy": "no-referrer",
};

function jsonResponse(
  body: unknown,
  status: number,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...FILES_RESPONSE_BASE_HEADERS,
    },
  });
}

/**
 * Checks that the caller (API key or session user) is allowed to read a file
 * owned by `ownerProjectId`. Throws HTTPException(403) or HTTPException(401)
 * on failure; returns void on success.
 */
async function authorizeFileRead({
  apiKeyProjectId,
  userId,
  ownerProjectId,
}: {
  apiKeyProjectId: string | undefined;
  userId: string | undefined;
  ownerProjectId: string;
}): Promise<void> {
  if (apiKeyProjectId) {
    if (apiKeyProjectId !== ownerProjectId) {
      throw new HTTPException(403, { message: "forbidden" });
    }
  } else if (userId) {
    try {
      await requireProjectPermission({
        userId,
        projectId: ownerProjectId,
        permission: "scenarios:view",
        prisma,
      });
    } catch {
      throw new HTTPException(403, { message: "forbidden" });
    }
  } else {
    throw new HTTPException(401, { message: "unauthenticated" });
  }
}

/**
 * Builds the 200 response for a stored-object read. Applies the safe
 * Content-Type allowlist, Content-Disposition, Content-Length, and all
 * security headers. For HEAD requests the stream is drained and the body is
 * omitted; for GET the stream is forwarded.
 */
function streamFileResponse({
  row,
  stream,
  method,
  mediaType,
}: {
  row: { id: string; size_bytes: number };
  stream: import("node:stream").Readable;
  method: "GET" | "HEAD";
  mediaType: string;
}): Response {
  const contentType = safeMediaType(mediaType);
  const filename = sanitizeFilenameSegment(row.id);

  const headers: Record<string, string> = {
    "Content-Type": contentType,
    "Content-Length": String(row.size_bytes),
    "Content-Disposition": `inline; filename="${filename}"`,
    ...FILES_RESPONSE_BASE_HEADERS,
  };

  if (method === "HEAD") {
    // Drain the stream so the storage driver doesn't leak a socket / fd.
    stream.destroy?.();
    return new Response(null, { status: 200, headers });
  }

  return new Response(Readable.toWeb(stream) as ReadableStream, {
    status: 200,
    headers,
  });
}

/**
 * GET /api/files/:projectId/:id  (project-scoped — issue #4947)
 * GET /api/files/:id             (legacy id-only — backward compatible)
 *
 * Streams the bytes for the given stored object id.
 *
 * Auth: either an API key scoped to the file's project, or a session cookie
 * belonging to a user with `scenarios:view` on that project.
 *
 * Owner resolution:
 *  - Project-scoped URL: the owning project is taken from the URL path. No
 *    cross-tenant lookup — the read is scoped directly to that project, and a
 *    URL whose `projectId` is not the caller's (403) or does not own the row
 *    (404) cannot serve another tenant's bytes.
 *  - Legacy id-only URL: the owning project is resolved from the
 *    stored_objects row via the cross-tenant fallback (NOT from any header),
 *    retained so URLs minted before #4947 keep resolving.
 *
 * Responses:
 *  200 — bytes streamed with a coerced Content-Type and Content-Length.
 *  401 — no valid credentials.
 *  403 — credentials are valid but the caller has no access to the project.
 *  404 — no row exists (status: not_found) OR storage 404d (status: missing).
 *  429 — per-caller rate limit exceeded (keyed before owner resolution).
 *  502 — row exists, storage returned a non-404 error.
 *
 * HEAD mirrors GET for byte-free probes (used by the UI MediaPart to
 * disambiguate "missing" vs "transient error" without paying for a full body
 * download).
 */
async function handleFileRead(
  c: Parameters<MiddlewareHandler<{ Variables: DualAuthVariables }>>[0],
  options: { method: "GET" | "HEAD" },
): Promise<Response> {
  const id = c.req.param("id");
  if (!id) {
    return jsonResponse({ status: "not_found" }, 404);
  }
  // Present only on the project-scoped route (`/api/files/:projectId/:id`).
  // Undefined on the legacy id-only route (`/api/files/:id`).
  const projectIdFromUrl = c.req.param("projectId");

  // Step 1: per-caller rate limit (AC12). Keyed on the caller's identity
  // (apiKeyProjectId or userId) so that enumeration attempts are throttled
  // BEFORE we touch the shared cross-tenant CH client. Using the owner
  // project as the key would require the cross-tenant lookup first, which
  // lets an authenticated user fan out id probes against other tenants
  // before hitting any throttle.
  const apiKeyProjectId = c.get("apiKeyProjectId");
  const userId = c.get("userId");
  const callerKey = apiKeyProjectId ?? userId;
  if (!callerKey) {
    // dualAuth guarantees one of these is set by the time we reach the
    // rate-limit step; reaching this branch means a future refactor of
    // dualAuth broke its contract. Refuse rather than fall back to a
    // shared "unknown" bucket (DoS amplification surface).
    throw new HTTPException(500, { message: "rate-limit key unresolved" });
  }
  const rl = await rateLimit({
    key: `files-route:caller:${callerKey}`,
    windowSeconds: FILES_RATE_LIMIT_WINDOW_SECONDS,
    max: FILES_RATE_LIMIT_MAX,
  });
  if (!rl.allowed) {
    return new Response(
      JSON.stringify({ error: "rate_limited" }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000))),
          ...FILES_RESPONSE_BASE_HEADERS,
        },
      },
    );
  }

  // Step 2: resolve the owning project.
  //
  // Project-scoped URL (`/api/files/:projectId/:id`, issue #4947): the URL
  // carries the claimed owner, so take it directly — no cross-tenant lookup.
  // The authorization gate (step 3) rejects a claim that is not the caller's
  // own project, and the project-scoped read (step 4) returns 404 when the
  // claim does not actually own the row. So a tampered or foreign `projectId`
  // in the URL can never serve another tenant's bytes, and the 403-vs-404
  // cross-tenant existence oracle is closed (a foreign claim is always 403,
  // regardless of whether the row exists).
  //
  // Legacy id-only URL (`/api/files/:id`): no project context in the URL, so
  // fall back to the cross-tenant owner lookup. The lookup fans out across
  // every configured ClickHouse instance with failure isolation: a transient
  // outage on a private/BYOC instance throws
  // `StoredObjectOwnerLookupUnavailableError` so this route can return 502
  // rather than masking the degraded instance as a 404 (Sergio review
  // 2026-05-20). Retained so URLs embedded in historical message content keep
  // resolving — no backfill (see #4947).
  let owner: { projectId: string } | null;
  if (projectIdFromUrl) {
    owner = { projectId: projectIdFromUrl };
  } else {
    try {
      owner = await resolveStoredObjectOwner({ id });
    } catch (err) {
      if (err instanceof StoredObjectOwnerLookupUnavailableError) {
        return jsonResponse({ error: "file temporarily unavailable" }, 502);
      }
      throw err;
    }
    if (!owner) {
      return jsonResponse({ status: "not_found" }, 404);
    }
  }

  // Pin the authorized project once: the membership gate (step 3) and the
  // project-scoped read (step 4) MUST use the same value, or a future edit
  // could authorize one project and read another (cross-tenant leak). One
  // binding makes that divergence impossible to introduce by accident.
  const authorizedProjectId = owner.projectId;

  // Step 3: project-membership gate.
  await authorizeFileRead({
    apiKeyProjectId,
    userId,
    ownerProjectId: authorizedProjectId,
  });

  // Step 4: project-scoped read.
  const service = createStoredObjectsService({ projectId: authorizedProjectId });

  let result;
  try {
    result = await service.getById({ projectId: authorizedProjectId, id });
  } catch {
    return jsonResponse({ error: "file temporarily unavailable" }, 502);
  }

  if (!result) {
    return jsonResponse({ status: "not_found" }, 404);
  }

  if (!("stream" in result)) {
    return jsonResponse({ status: "missing" }, 404);
  }

  // Step 5: build and return the response.
  return streamFileResponse({
    row: result.row,
    stream: result.stream,
    method: options.method,
    mediaType: result.row.media_type,
  });
}

// Project-scoped routes (issue #4947) — registered before the legacy
// id-only routes. Hono matches by path-segment count, so a two-segment
// request resolves here and a one-segment request resolves to the legacy
// handler below; the ordering is belt-and-suspenders.
secured
  .access(anyAuthenticated())
  .get("/:projectId/:id", (c) => handleFileRead(c, { method: "GET" }));
secured
  .access(anyAuthenticated())
  .head("/:projectId/:id", (c) => handleFileRead(c, { method: "HEAD" }));

// Legacy id-only routes — retained for URLs minted before #4947.
secured
  .access(anyAuthenticated())
  .get("/:id", (c) => handleFileRead(c, { method: "GET" }));
secured
  .access(anyAuthenticated())
  .head("/:id", (c) => handleFileRead(c, { method: "HEAD" }));

export const app = secured.hono;
export type FilesAppType = typeof app;
