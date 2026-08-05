/**
 * StoredObjects tRPC router.
 *
 * Provides server-side existence probes for stored objects so the UI
 * does not need to issue raw `fetch` calls to /api/files/:id.  Auth is
 * inherited from the tRPC session, which avoids the CORS / credential
 * fragility of a native HEAD probe.
 */
import { z } from "zod";
import { checkProjectPermissionAny } from "~/server/api/rbac";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
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
 * Auth: session user must have `traces:view` OR `scenarios:view` on
 * `projectId`, mirroring the `/api/files/:id` route's own gate. The same
 * stored object is trace media for one viewer and scenario media for another,
 * and the two permissions are separate categories a custom role can hold one
 * of — a probe narrower than the read it describes leaves a viewer who can
 * fetch the bytes unable to find out why the player failed, which strands the
 * renderer in its loading state.
 */
export const storedObjectsRouter = createTRPCRouter({
  headById: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        id: z.string(),
      }),
    )
    .use(checkProjectPermissionAny("traces:view", "scenarios:view"))
    .query(async ({ input }) => {
      const { projectId, id } = input;
      const service = createStoredObjectsService({ projectId });
      return service.headById({ projectId, id });
    }),
});
