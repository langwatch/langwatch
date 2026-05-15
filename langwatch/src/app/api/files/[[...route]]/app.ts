import { Readable } from "node:stream";
import type { Project } from "@prisma/client";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { MiddlewareHandler } from "hono";
import { getServerAuthSession } from "~/server/auth";
import { prisma } from "~/server/db";
import { requireProjectPermission } from "~/server/auth/permissions";
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
 * 401 these. So we try API-key auth first; if that fails, we accept a valid
 * session cookie and let the per-row project-membership check downstream
 * decide whether the caller may read the bytes.
 *
 * On success, `c.var.userId` is set so the handler can run the membership
 * check via requireProjectPermission. API-key callers don't need a userId —
 * they're already gated to a project and the row's project_id must match.
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
  } catch {
    // fall through to session auth
  }

  const session = await getServerAuthSession({ req: c.req.raw });
  if (!session?.user?.id) {
    throw new HTTPException(401, { message: "unauthenticated" });
  }
  c.set("userId", session.user.id);
  return next();
};

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
 *  200 — bytes streamed with correct Content-Type and Content-Length.
 *  401 — no valid credentials.
 *  403 — credentials are valid but the caller has no access to the project.
 *  404 — no row exists OR row exists but storage 404d.
 *  502 — row exists, storage returned a non-404 error.
 */
app.get("/:id", dualAuth, async (c) => {
  const id = c.req.param("id");
  if (!id) {
    return c.json({ status: "not_found" }, 404);
  }

  // Step 1: resolve the owning project from the row id (cross-tenant lookup).
  const bootstrapService = createStoredObjectsService({
    projectId: "__bootstrap__",
  });
  const owner = await bootstrapService.resolveOwnerProject({ id });
  if (!owner) {
    return c.json({ status: "not_found" }, 404);
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

  // Step 3: standard project-scoped read.
  // TODO(AC12): wire per-project rate limit when middleware exists.
  const service = createStoredObjectsService({ projectId: owner.projectId });

  let result;
  try {
    result = await service.getById({ projectId: owner.projectId, id });
  } catch {
    return c.json({ error: "file temporarily unavailable" }, 502);
  }

  if (!result) {
    return c.json({ status: "not_found" }, 404);
  }

  if (!("stream" in result)) {
    return c.json({ status: "missing" }, 404);
  }

  const { row, stream } = result;

  return new Response(Readable.toWeb(stream) as ReadableStream, {
    status: 200,
    headers: {
      "Content-Type": row.media_type,
      "Content-Length": String(row.size_bytes),
    },
  });
});

export type FilesAppType = typeof app;
