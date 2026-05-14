import { Readable } from "node:stream";
import type { Project } from "@prisma/client";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { createStoredObjectsService } from "~/server/stored-objects/stored-objects-factory";
import {
  authMiddleware,
  handleError,
  loggerMiddleware,
  tracerMiddleware,
} from "../../middleware";

type Variables = {
  project: Project;
};

export const app = new Hono<{ Variables: Variables }>().basePath("/api/files");

app.use(tracerMiddleware({ name: "files" }));
app.use(loggerMiddleware());
app.use("/*", authMiddleware);
app.onError(handleError);

/**
 * GET /api/files/:id
 *
 * Streams the bytes for the given stored object id.
 *
 * Auth: the caller must present credentials scoped to the same project that
 * owns the file. The owning project is resolved from the stored_objects row
 * (NOT from the caller's session-active project header).
 *
 * Responses:
 *  200 — bytes streamed with correct Content-Type and Content-Length.
 *  401 — no valid credentials.
 *  403 — credentials are valid but scoped to a different project.
 *  404 — no row exists OR row exists but storage 404d.
 *  502 — row exists, storage returned a non-404 error.
 */
app.get("/:id", async (c) => {
  const id = c.req.param("id");
  const { project } = c.var;

  if (!project) {
    throw new HTTPException(401, { message: "unauthenticated" });
  }

  // Step 1: which project owns this file?
  // createStoredObjectsService requires a projectId, but resolveOwnerProject
  // is a cross-tenant lookup — the projectId passed here is only used to
  // construct the service and is not forwarded to the cross-tenant query.
  // We use the caller's authenticated project as the bootstrap value, but the
  // actual lookup ignores it (see StoredObjectsRepository.findProjectByObjectId).
  const bootstrapService = createStoredObjectsService({ projectId: project.id });
  const owner = await bootstrapService.resolveOwnerProject({ id });

  if (!owner) {
    return c.json({ status: "not_found" }, 404);
  }

  // Step 2: project-membership gate — the caller's credential must be scoped
  // to the same project that owns the file.
  if (project.id !== owner.projectId) {
    throw new HTTPException(403, { message: "forbidden" });
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
