/**
 * Public REST for reading the bytes of a stored object.
 */
import { Readable } from "node:stream";
import type { AuthzPermission } from "@langwatch/authz-contract";
import { HandledError } from "@langwatch/handled-error";
import { StoredObjectOwnerLookupUnavailableError } from "@langwatch/stored-object-contract";
import type { Context, Env, MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { anyAuthenticated } from "@langwatch/api";
import {
  type AppRestSecurity,
  jsonResponse,
  rateLimitedResponse,
  safeMediaType,
  sanitizeFilenameSegment,
  type SecuredApp,
  STORED_OBJECT_RESPONSE_BASE_HEADERS as FILES_RESPONSE_BASE_HEADERS,
} from "@langwatch/api/rest";
import type { StoredObjectApp } from "#app/stored-object.app";

/**
 * What the family's dual-auth verifier leaves on the request context.
 */
export type FilesDualAuthVariables = {
  apiKeyProjectId?: string;
  userId?: string;
  /**
   * The resolved key's ceiling. The key branch used to compare the caller's own `X-Project-Id` against
   * the owner and pass, so a key scoped to one project read every project's bytes. Which permission to
   * ask for is this family's decision, which is why it arrives as a call rather than a chain.
   */
  apiKeyCeiling?: (permission: AuthzPermission) => Promise<void>;
};

/**
 * Per-project rate limit on the read endpoint.
 */
const FILES_RATE_LIMIT_WINDOW_SECONDS = 60;
const FILES_RATE_LIMIT_MAX = 120;

/**
 * Stored objects are shared by several features, and which permission guards a read depends on what
 * the object IS: trace media requires `traces:view`, scenario media requires `scenarios:view` — the
 * two are separate permission categories and a custom role can hold one without the other.
 */
const FILE_VIEW_PERMISSIONS = ["traces:view", "scenarios:view"] as const;

/**
 * The key's ceiling, satisfied by ANY of the permissions a file read can need.
 */
async function enforceAnyOf(
  ceiling: (permission: AuthzPermission) => Promise<void>,
  permissions: readonly AuthzPermission[],
): Promise<void> {
  let refusal: unknown;
  for (const permission of permissions) {
    try {
      await ceiling(permission);
      return;
    } catch (err) {
      if (!HandledError.isHandled(err)) throw err;
      refusal = err;
    }
  }
  throw refusal;
}

export function requiredPermissionForPurpose(
  purpose: string,
): (typeof FILE_VIEW_PERMISSIONS)[number] {
  return purpose === "trace_content" ? "traces:view" : "scenarios:view";
}

/** The codes the permission check raises when it refuses the caller. */
const DENIAL_CODES: ReadonlySet<string> = new Set([
  "project_permission_denied",
  "lite_member_restricted",
  // The ADR-092 engine's denial. A route that has migrated to
  // `authz.authorize()` throws this instead of the legacy pair, and without
  // it here the engine's 403 would surface as a 500.
  "permission_denied",
]);

/**
 * True only for the denial shapes the permission check documents. Anything
 * else — a dropped database connection, a Prisma fault — is an infrastructure
 * failure that must bubble up as a 5xx, never be masked as a 403.
 */
export function isPermissionDenial(err: unknown): boolean {
  return HandledError.isHandled(err) && DENIAL_CODES.has(err.code);
}

/**
 * Refuses the read unless `userId` holds `permission` on `projectId`.
 */
export type FilesProjectPermissionCheck = (args: {
  userId: string;
  projectId: string;
  permission: (typeof FILE_VIEW_PERMISSIONS)[number];
}) => Promise<void>;

/** A fixed-window counter, keyed on the caller. */
export type FilesRateLimiter = (args: {
  key: string;
  windowSeconds: number;
  max: number;
}) => Promise<{ allowed: boolean; resetAt: number }>;

/**
 * Builds the 200 response for a stored-object read. Applies the safe Content-Type
 * allowlist, Content-Disposition, Content-Length, and all security headers. For HEAD
 * requests the stream is drained and the body is omitted; for GET the stream is forwarded.
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

/** The files REST family, built against one process's security and services. */
export function createFilesRestApp<
  // Constrained, not merely defaulted: the read handler below reads the
  // dual-auth variables off the context, and a caller widening `E` must still
  // be supplying them.
  E extends Env & { Variables: FilesDualAuthVariables } = {
    Variables: FilesDualAuthVariables;
  },
>(options: {
  security: AppRestSecurity;
  /**
   * Resolved per request, as reading it off the Hono context used to be:
   * mounting a family must not force its services to be constructed, which is
   * what lets the OpenAPI spec generator build this app with none.
   */
  app: () => StoredObjectApp;
  /** Accepts a project API key OR a browser session, and refuses both at once. */
  dualAuth: MiddlewareHandler;
  requireProjectPermission: FilesProjectPermissionCheck;
  rateLimit: FilesRateLimiter;
}): SecuredApp<E> {
  const { security, app, dualAuth, requireProjectPermission, rateLimit } = options;

  // File reads authenticate via dualAuth (project API key OR user session) and
  // authorize per-object in the handler (authorizeFileRead checks the caller's
  // project against the object owner). The policy is anyAuthenticated() with
  // dualAuth as the verifier; cross-tenant access is denied in-handler.
  const secured = security.createServiceApp<E>({
    basePath: "/api/files",
    verifySecret: dualAuth,
  });

  /**
   * Checks that the caller (API key or session user) is allowed to read files owned by `ownerProjectId` AT ALL. Runs BEFORE the row is read so a foreign claim is always 403 regardless of row existence (no
   * 403-vs-404 oracle); because the object's purpose is not known yet, a caller passes with ANY of the file-view permissions — the purpose-specific gate runs after the read (`authorizeFilePurpose`). An API key is
   * pinned to the project it resolved to AND capped by its own ceiling. Throws HTTPException(403)/(401) or the key's own refusal on failure; returns void on success.
   */
  async function authorizeFileRead({
    apiKeyProjectId,
    apiKeyCeiling,
    userId,
    ownerProjectId,
  }: {
    apiKeyProjectId: string | undefined;
    apiKeyCeiling: FilesDualAuthVariables["apiKeyCeiling"];
    userId: string | undefined;
    ownerProjectId: string;
  }): Promise<void> {
    if (apiKeyProjectId) {
      if (apiKeyProjectId !== ownerProjectId) {
        throw new HTTPException(403, { message: "forbidden" });
      }
      if (!apiKeyCeiling) {
        // The verifier sets this on every key it resolves; reaching here means
        // a future edit broke that contract. Refuse rather than read.
        throw new HTTPException(500, { message: "api key ceiling unresolved" });
      }
      await enforceAnyOf(apiKeyCeiling, FILE_VIEW_PERMISSIONS);
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
   * Purpose-specific authorization, applied once the row (and so its purpose) is known: `trace_content` objects
   * require `traces:view`, everything else (the scenario purposes) requires `scenarios:view`. An API-key caller was
   * already pinned to the owning project and capped by its own ceiling in `authorizeFileRead`.
   */
  async function authorizeFilePurpose({
    userId,
    ownerProjectId,
    purpose,
  }: {
    userId: string | undefined;
    ownerProjectId: string;
    purpose: string;
  }): Promise<void> {
    if (!userId) return;
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
   * GET /api/files/:projectId/:id (project-scoped — issue #4947) GET
   * /api/files/:id (legacy id-only — backward compatible)
   */
  async function handleFileRead(
    // `E`, not the default: Hono's `Context` is invariant in its environment,
    // so a context built from the app's own `E` is not assignable to one
    // written in terms of the default.
    c: Context<E, string, Record<string, never>>,
    readOptions: { method: "GET" | "HEAD" },
  ): Promise<Response> {
    const id = c.req.param("id");
    if (!id) {
      return jsonResponse({ status: "not_found" }, 404);
    }
    // Present only on the project-scoped route (`/api/files/:projectId/:id`).
    // Undefined on the legacy id-only route (`/api/files/:id`).
    const projectIdFromUrl = c.req.param("projectId");

    // Step 1: per-caller rate limit (AC12). Keyed on the caller's identity (apiKeyProjectId or
    // userId) so that enumeration attempts are throttled BEFORE we touch the shared
    // cross-tenant CH client. Using the owner project as the key would require the
    // cross-tenant lookup first, which lets an authenticated user fan out id probes against
    // other tenants before hitting any throttle.
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
      return rateLimitedResponse(rl.resetAt);
    }

    // Step 2: resolve the owning project. Project-scoped URL (`/api/files/:projectId/:id`, issue #4947): the URL carries the claimed owner, so take it directly — no cross-tenant lookup. The authorization gate (step 3) rejects a claim that
    // is not the caller's own project, and the project-scoped read (step 4) returns 404 when the claim does not actually own the row. So a tampered or foreign `projectId` in the URL can never serve another tenant's bytes, and the
    // 403-vs-404 cross-tenant existence oracle is closed (a foreign claim is always 403, regardless of whether the row exists). Legacy id-only URL (`/api/files/:id`): no project context in the URL, so fall back to the cross-tenant owner
    // lookup. The lookup fans out across every configured ClickHouse instance with failure isolation: a transient outage on a private/BYOC instance throws `StoredObjectOwnerLookupUnavailableError` so this route can return 502 rather than
    // masking the degraded instance as a 404 (Sergio review 2026-05-20). Retained so URLs embedded in historical message content keep resolving — no backfill (see #4947).
    let owner: { projectId: string } | null;
    if (projectIdFromUrl) {
      owner = { projectId: projectIdFromUrl };
    } else {
      try {
        owner = await app().resolveOwner({ id });
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
      apiKeyCeiling: c.get("apiKeyCeiling"),
      userId,
      ownerProjectId: authorizedProjectId,
    });

    // Step 4: project-scoped read.
    let result;
    try {
      result = await app().readById({
        projectId: authorizedProjectId,
        id,
      });
    } catch {
      return jsonResponse({ error: "file temporarily unavailable" }, 502);
    }

    if (!result) {
      return jsonResponse({ status: "not_found" }, 404);
    }

    // Step 4.5: purpose gate — now that the row is known, enforce the
    // permission category the object's purpose maps to.
    await authorizeFilePurpose({
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
      method: readOptions.method,
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
  secured.access(anyAuthenticated()).get("/:id", (c) => handleFileRead(c, { method: "GET" }));
  secured.access(anyAuthenticated()).head("/:id", (c) => handleFileRead(c, { method: "HEAD" }));

  return secured;
}
