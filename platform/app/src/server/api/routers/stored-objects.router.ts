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
import { requireProjectPermission } from "~/server/app-layer/permissions/imperative";
import { requiredPermissionForPurpose } from "~/server/stored-objects/purpose-permission";
import { createStoredObjectsService } from "~/server/stored-objects/stored-objects-factory";

/**
 * Probes whether a stored object's row AND bytes exist.
 *
 * Returns a tri-state matching the `/api/files/:id` HTTP route:
 *  - `{ status: "available", mediaType }` - row exists and storage has the bytes
 *  - `{ status: "missing", mediaType }`   - row exists but the blob is gone
 *    (compensating delete crashed, retention sweep, etc.)
 *  - `{ status: "not_found" }`            - no row matches
 *
 * The renderer maps `"missing"` to the placeholder badge (feature
 * requirement) and `"not_found"` to a generic error. The pre-fix router
 * only checked the row, which collapsed the `"missing"` case into
 * `exists: true` - the renderer then mapped that to "transient decode
 * error" and dropped the missing badge.
 *
 * Auth is the same two-step the read route applies, because a probe wider than
 * the read it describes tells a caller which objects exist in a category it
 * cannot open:
 *
 *  1. Before the read, any of `traces:view`, `scenarios:view` or
 *     `datasets:view`. The object's purpose is not known yet, and the same
 *     stored object is trace media for one viewer and dataset media for
 *     another, so a single hardwired permission would refuse a viewer who can
 *     open the bytes and strand the renderer in its loading state.
 *  2. After the read, the one permission the row's own purpose asks for
 *     (`requiredPermissionForPurpose`). A dataset-only viewer therefore
 *     probes dataset attachments and nothing else.
 *
 * The purpose itself never leaves the server: it decides the gate and is
 * dropped from the answer.
 */
export const storedObjectsRouter = createTRPCRouter({
  headById: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        id: z.string(),
      }),
    )
    .permissionAny("traces:view", "scenarios:view", "datasets:view")
    .query(async ({ ctx, input }) => {
      const { projectId, id } = input;
      const service = createStoredObjectsService({ projectId });
      const probe = await service.headById({ projectId, id });
      if (probe.status === "not_found") return probe;

      await requireProjectPermission(
        ctx,
        projectId,
        requiredPermissionForPurpose(probe.purpose),
      );

      return { status: probe.status, mediaType: probe.mediaType };
    }),
});
