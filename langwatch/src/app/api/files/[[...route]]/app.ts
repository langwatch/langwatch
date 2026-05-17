import { Readable } from "node:stream";
import type { Project } from "@prisma/client";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { MiddlewareHandler } from "hono";
import { getServerAuthSession } from "~/server/auth";
import { prisma } from "~/server/db";
import { requireProjectPermission } from "~/server/auth/permissions";
import { rateLimit } from "~/server/rateLimit";
import { resolveStoredObjectOwner } from "~/server/stored-objects/stored-objects-cross-tenant-lookup";
import { createStoredObjectsService } from "~/server/stored-objects/stored-objects-factory";
import {
  authMiddleware,
  handleError,
  loggerMiddleware,
  tracerMiddleware,
} from "../../middleware";

type Variables = {
  project?: Project;
  apiKeyProjectId?: string;
  userId?: string;
};

export const app = new Hono<{ Variables: Variables }>().basePath("/api/files");

app.use(tracerMiddleware({ name: "files" }));
app.use(loggerMiddleware());
app.onError(handleError);

/**
 * Dual-auth middleware for the file routes.
 *
 * Browsers fire <audio src="/api/files/:id"> with the session cookie and no
 * custom headers — the standard authMiddleware (API key headers only) would
 * 401 these. So we try API-key auth first; if it returns 401/403 we accept
 * a valid session cookie. Any other failure (5xx, DB outage, malformed
 * config) surfaces to the caller instead of being silently retried as
 * session auth — masking real errors as 401 is its own bug class.
 *
 * On success, `c.var.userId` (session path) or `c.var.apiKeyProjectId`
 * (API-key path) is set so the handler can apply the right gate.
 */
const dualAuth: MiddlewareHandler<{ Variables: Variables }> = async (
  c,
  next,
) => {
  try {
    await authMiddleware(c, async () => {
      /* no-op: just want the side effect of populating c.var.project */
    });
    const project = c.get("project");
    if (project) {
      c.set("apiKeyProjectId", project.id);
      return await next();
    }
  } catch (err) {
    if (err instanceof HTTPException) {
      const status = err.status as number;
      // 401 / 403 — fall through to session auth. Anything else is a real
      // server-side failure; let it bubble up to onError as a 5xx.
      if (status !== 401 && status !== 403) throw err;
    } else {
      // Non-HTTPException: don't swallow.
      throw err;
    }
  }

  const session = await getServerAuthSession({ req: c.req.raw });
  if (!session?.user?.id) {
    throw new HTTPException(401, { message: "unauthenticated" });
  }
  c.set("userId", session.user.id);
  return next();
};

/**
 * Media types we'll serve with the requested Content-Type. Anything else
 * is coerced to application/octet-stream to neutralize MIME sniffing and
 * stored-XSS primitives (an attacker can't trick a browser into
 * interpreting their payload as text/html or application/javascript).
 *
 * Conservative on purpose — operators can widen the list when a new
 * media kind ships through scenario events.
 */
const SAFE_MEDIA_TYPE_PREFIXES = [
  "audio/",
  "image/",
  "video/",
] as const;

const SAFE_MEDIA_TYPES_EXACT = new Set([
  "application/pdf",
  "application/octet-stream",
]);

function safeMediaType(mediaType: string): string {
  if (SAFE_MEDIA_TYPES_EXACT.has(mediaType)) return mediaType;
  if (SAFE_MEDIA_TYPE_PREFIXES.some((p) => mediaType.startsWith(p))) {
    return mediaType;
  }
  return "application/octet-stream";
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
 * GET /api/files/:id
 *
 * Streams the bytes for the given stored object id.
 *
 * Auth: either an API key scoped to the file's project, or a session cookie
 * belonging to a user with `scenarios:view` on that project. The owning
 * project is resolved from the stored_objects row (NOT from any header).
 *
 * Responses:
 *  200 — bytes streamed with a coerced Content-Type and Content-Length.
 *  401 — no valid credentials.
 *  403 — credentials are valid but the caller has no access to the project.
 *  404 — no row exists (status: not_found) OR storage 404d (status: missing).
 *  429 — per-project rate limit exceeded.
 *  502 — row exists, storage returned a non-404 error.
 *
 * HEAD /api/files/:id mirrors GET for byte-free probes (used by the UI
 * MediaPart to disambiguate "missing" vs "transient error" without paying
 * for a full body download).
 */
async function handleFileRead(
  c: Parameters<MiddlewareHandler<{ Variables: Variables }>>[0],
  options: { method: "GET" | "HEAD" },
): Promise<Response> {
  const id = c.req.param("id");
  if (!id) {
    return jsonResponse({ status: "not_found" }, 404);
  }

  // Step 1: resolve the owning project from the row id (cross-tenant lookup).
  const owner = await resolveStoredObjectOwner({ id });
  if (!owner) {
    return jsonResponse({ status: "not_found" }, 404);
  }

  // Step 2: project-membership gate.
  const apiKeyProjectId = c.get("apiKeyProjectId");
  const userId = c.get("userId");

  if (apiKeyProjectId) {
    if (apiKeyProjectId !== owner.projectId) {
      throw new HTTPException(403, { message: "forbidden" });
    }
  } else if (userId) {
    try {
      await requireProjectPermission({
        userId,
        projectId: owner.projectId,
        permission: "scenarios:view",
        prisma,
      });
    } catch {
      throw new HTTPException(403, { message: "forbidden" });
    }
  } else {
    throw new HTTPException(401, { message: "unauthenticated" });
  }

  // Step 3: per-project rate limit (AC12). Keyed on the owning project so
  // a tenant burning their quota can't drag down sibling tenants. Cheap
  // enough to run inside the request path — one Redis INCR + TTL fetch.
  const rl = await rateLimit({
    key: `files-route:${owner.projectId}`,
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

  // Step 4: project-scoped read.
  const service = createStoredObjectsService({ projectId: owner.projectId });

  let result;
  try {
    result = await service.getById({ projectId: owner.projectId, id });
  } catch {
    return jsonResponse({ error: "file temporarily unavailable" }, 502);
  }

  if (!result) {
    return jsonResponse({ status: "not_found" }, 404);
  }

  if (!("stream" in result)) {
    return jsonResponse({ status: "missing" }, 404);
  }

  const { row, stream } = result;
  const contentType = safeMediaType(row.media_type);
  const filename = sanitizeFilenameSegment(row.id);

  const headers: Record<string, string> = {
    "Content-Type": contentType,
    "Content-Length": String(row.size_bytes),
    "Content-Disposition": `inline; filename="${filename}"`,
    ...FILES_RESPONSE_BASE_HEADERS,
  };

  if (options.method === "HEAD") {
    // Drain the stream so the storage driver doesn't leak a socket / fd.
    stream.destroy?.();
    return new Response(null, { status: 200, headers });
  }

  return new Response(Readable.toWeb(stream) as ReadableStream, {
    status: 200,
    headers,
  });
}

app.get("/:id", dualAuth, (c) => handleFileRead(c, { method: "GET" }));
app.on("HEAD", "/:id", dualAuth, (c) =>
  handleFileRead(c, { method: "HEAD" }),
);

export type FilesAppType = typeof app;
