/**
 * StoredObjects tRPC router.
 *
 * Provides server-side existence probes for stored objects so the UI
 * does not need to issue raw `fetch` calls to /api/files/:id.  Auth is
 * inherited from the tRPC session, which avoids the CORS / credential
 * fragility of a native HEAD probe.
 */
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { checkProjectPermission } from "~/server/api/rbac";
import { createStoredObjectsService } from "~/server/stored-objects/stored-objects-factory";

/**
 * Probes whether a stored object's row AND bytes exist.
 *
 * Returns a tri-state matching the `/api/files/:id` HTTP route:
 *  - `{ status: "available", mediaType }` — row exists and storage has the bytes
 *  - `{ status: "missing", mediaType }`   — row exists but the blob is gone
 *    (compensating delete crashed, retention sweep, etc.)
 *  - `{ status: "not_found" }`            — no row matches
 *
 * The renderer maps `"missing"` to the placeholder badge (feature
 * requirement) and `"not_found"` to a generic error. The pre-fix router
 * only checked the row, which collapsed the `"missing"` case into
 * `exists: true` — the renderer then mapped that to "transient decode
 * error" and dropped the missing badge.
 *
 * Auth: session user must have `scenarios:view` on `projectId`.
 */
export const storedObjectsRouter = createTRPCRouter({
  headById: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        id: z.string(),
      }),
    )
    .use(checkProjectPermission("scenarios:view"))
    .query(async ({ input }) => {
      const { projectId, id } = input;
      const service = createStoredObjectsService({ projectId });
      return service.headById({ projectId, id });
    }),
});
