import { Readable } from "node:stream";
import { HandledError } from "@langwatch/handled-error";
import type { MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Permission } from "~/server/api/rbac";
import { anyAuthenticated, createServiceApp } from "~/server/api/security";
import { enforceApiKeyCeiling } from "~/server/api-key/auth-middleware";
import type { ResolvedToken } from "~/server/api-key/token-resolver";
import { requireProjectPermission } from "~/server/auth/permissions";
import { rateLimit } from "~/server/rateLimit";
import {
  STORED_OBJECT_RESPONSE_BASE_HEADERS as FILES_RESPONSE_BASE_HEADERS,
  jsonResponse,
  rateLimitedResponse,
  safeMediaType,
  sanitizeFilenameSegment,
} from "~/server/stored-objects/media-response";
import {
  resolveStoredObjectOwner,
  StoredObjectOwnerLookupUnavailableError,
} from "~/server/stored-objects/stored-objects-cross-tenant-lookup";
import { createStoredObjectsService } from "~/server/stored-objects/stored-objects-factory";
import type { DualAuthVariables } from "../../middleware/dual-auth";
import { dualAuth } from "../../middleware/dual-auth";

// File reads authenticate via dualAuth (project API key OR user session) and
// authorize per-object in the handler (authorizeFileRead checks the caller's
// project against the object owner). The policy is anyAuthenticated() with
// dualAuth as the verifier; cross-tenant access is denied in-handler.
const secured = createServiceApp<{ Variables: DualAuthVariables }>({
  basePath: "/api/files",
  verifySecret: dualAuth,
});

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
 * Stored objects are shared by several features, and which permission guards
 * a read depends on what the object IS: trace media requires `traces:view`,
 * scenario media requires `scenarios:view` — the two are separate permission
 * categories and a custom role can hold one without the other.
 */
const FILE_VIEW_PERMISSIONS = ["traces:view", "scenarios:view"] as const;

export function requiredPermissionForPurpose(
  purpose: string,
): (typeof FILE_VIEW_PERMISSIONS)[number] {
  return purpose === "trace_content" ? "traces:view" : "scenarios:view";
}

/** The codes `requireProjectPermission` raises when it refuses the caller. */
const DENIAL_CODES: ReadonlySet<string> = new Set([
  "project_permission_denied",
  "lite_member_restricted",
  // The ADR-092 engine's denial. A route that has migrated to
  // `authz.authorize()` throws this instead of the legacy pair, and without
  // it here the engine's 403 would surface as a 500.
  "permission_denied",
  // The API-key ceiling's two denials, for the same reason: this route
  // enforces the key's permissions itself (see `apiKeyHoldsAny`), and a
  // ceiling refusal is a 403 here, not an unhandled 500.
  "api_key_permission_denied",
  "api_key_permission_not_delegable",
]);

/**
 * True only for the denial shapes `requireProjectPermission` documents.
 * Anything else — a dropped database connection, a Prisma fault — is an
 * infrastructure failure that must bubble up as a 5xx, never be masked as
 * a 403.
 *
 * Matched on `code`, never on prose. This used to compare the denial's message
 * word for word, which made a copy edit a silent behaviour change: reword the
 * sentence and every denial here quietly becomes a 500. Codes are the stable
 * half of a handled error precisely so control flow can rest on them, and
 * `code` survives a serialisation boundary where `instanceof` would not.
 */
export function isPermissionDenial(err: unknown): boolean {
  return HandledError.isHandled(err) && DENIAL_CODES.has(err.code);
}

/**
 * Whether the resolved credential holds ANY of `permissions`, through the
 * same ceiling every other API-key surface is gated by.
 *
 * A legacy project key passes every permission by design (it predates RBAC
 * and carries full project access), so this changes nothing for the callers
 * the exemption was originally written for — `enforceApiKeyCeiling` returns
 * immediately for that credential class. It is the scoped key, which arrived
 * later, that is now held to its bindings.
 *
 * A missing credential is not a pass: reaching here with no resolved token
 * means the caller authenticated by session, and the session branch does its
 * own check.
 */
async function apiKeyHoldsAny(
  resolvedToken: ResolvedToken | undefined,
  permissions: readonly Permission[],
): Promise<boolean> {
  if (!resolvedToken) return false;

  for (const permission of permissions) {
    try {
      await enforceApiKeyCeiling({ resolved: resolvedToken, permission });
      return true;
    } catch (err) {
      if (!isPermissionDenial(err)) throw err;
      // denied this category — try the next one
    }
  }
  return false;
}

/**
 * Checks that the caller (API key or session user) is allowed to read files
 * owned by `ownerProjectId` AT ALL. Runs BEFORE the row is read so a foreign
 * claim is always 403 regardless of row existence (no 403-vs-404 oracle);
 * because the object's purpose is not known yet, a session user passes with
 * ANY of the file-view permissions — the purpose-specific gate runs after
 * the read (`authorizeFilePurpose`). Throws HTTPException(403)/(401) on
 * failure; returns void on success.
 */
export async function authorizeFileRead({
  apiKeyProjectId,
  resolvedToken,
  userId,
  ownerProjectId,
}: {
  apiKeyProjectId: string | undefined;
  resolvedToken: ResolvedToken | undefined;
  userId: string | undefined;
  ownerProjectId: string;
}): Promise<void> {
  if (apiKeyProjectId) {
    if (apiKeyProjectId !== ownerProjectId) {
      throw new HTTPException(403, { message: "forbidden" });
    }
    // Tenancy is not authorization. Pinning the key to the owning project
    // says only that it is in the right tenant; a key scoped to this project
    // but granted, say, only `prompts:view` was still served trace bytes.
    // The session branch below has always had to hold one of these.
    if (!(await apiKeyHoldsAny(resolvedToken, FILE_VIEW_PERMISSIONS))) {
      throw new HTTPException(403, { message: "forbidden" });
    }
  } else if (userId) {
    for (const permission of FILE_VIEW_PERMISSIONS) {
      try {
        await requireProjectPermission({
          userId,
          projectId: ownerProjectId,
          permission,
        });
        return;
      } catch (err) {
        if (!isPermissionDenial(err)) throw err;
        // denied this category — try the next one
      }
    }
    throw new HTTPException(403, { message: "forbidden" });
  } else {
    throw new HTTPException(401, { message: "unauthenticated" });
  }
}

/**
 * Purpose-specific authorization, applied once the row (and so its purpose)
 * is known: `trace_content` objects require `traces:view`, everything else
 * (the scenario purposes) requires `scenarios:view`.
 *
 * Both credential kinds are held to it. An API key used to be exempt — the
 * comment here called it a "project-scoped full reader on this legacy-key
 * surface", which was true when the only key that reached this route was a
 * legacy project key carrying full project access. A scoped key does not,
 * so the exemption handed one the whole purpose range its bindings never
 * granted.
 */
export async function authorizeFilePurpose({
  resolvedToken,
  userId,
  ownerProjectId,
  purpose,
}: {
  resolvedToken: ResolvedToken | undefined;
  userId: string | undefined;
  ownerProjectId: string;
  purpose: string;
}): Promise<void> {
  const required = requiredPermissionForPurpose(purpose);

  if (!userId) {
    if (!(await apiKeyHoldsAny(resolvedToken, [required]))) {
      throw new HTTPException(403, { message: "forbidden" });
    }
    return;
  }
  try {
    await requireProjectPermission({
      userId,
      projectId: ownerProjectId,
      permission: requiredPermissionForPurpose(purpose),
    });
  } catch (err) {
    if (!isPermissionDenial(err)) throw err;
    throw new HTTPException(403, { message: "forbidden" });
  }
}

/**
 * Builds the 200 response for a stored-object read. Applies the safe
 * Content-Type allowlist, Content-Disposition, Content-Length, and all
 * security headers. For HEAD requests the stream is drained and the body is
 * omitted; for GET the stream is forwarded.
 *
 * `requestedFilename` is the caller-supplied display name (the `filename`
 * query param the attachment chip appends). Stored objects are
 * content-addressed, so the row itself has no filename; passing the
 * message-level one through gives downloads from the browser viewer a
 * human name instead of the object id. It runs through the same
 * `sanitizeFilenameSegment` allowlist as the id (header injection is
 * neutralised), and an empty sanitised result falls back to the id.
 */
function streamFileResponse({
  row,
  stream,
  method,
  mediaType,
  requestedFilename,
}: {
  row: { id: string; size_bytes: number };
  stream: Readable;
  method: "GET" | "HEAD";
  mediaType: string;
  requestedFilename?: string;
}): Response {
  const contentType = safeMediaType(mediaType);
  const filename =
    (requestedFilename ? sanitizeFilenameSegment(requestedFilename) : "") ||
    sanitizeFilenameSegment(row.id);

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
  const resolvedToken = c.get("resolvedToken") as ResolvedToken | undefined;
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
    return rateLimitedResponse(rl.resetAt);
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
    resolvedToken,
    userId,
    ownerProjectId: authorizedProjectId,
  });

  // Step 4: project-scoped read.
  const service = createStoredObjectsService({
    projectId: authorizedProjectId,
  });

  let result;
  try {
    result = await service.getById({ projectId: authorizedProjectId, id });
  } catch {
    return jsonResponse({ error: "file temporarily unavailable" }, 502);
  }

  if (!result) {
    return jsonResponse({ status: "not_found" }, 404);
  }

  // Step 4.5: purpose gate — now that the row is known, enforce the
  // permission category the object's purpose maps to.
  await authorizeFilePurpose({
    resolvedToken,
    userId,
    ownerProjectId: authorizedProjectId,
    purpose: result.row.purpose,
  });

  if (!("stream" in result)) {
    return jsonResponse({ status: "missing" }, 404);
  }

  // Step 5: build and return the response.
  return streamFileResponse({
    row: result.row,
    stream: result.stream,
    method: options.method,
    mediaType: result.row.media_type,
    requestedFilename: c.req.query("filename"),
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
