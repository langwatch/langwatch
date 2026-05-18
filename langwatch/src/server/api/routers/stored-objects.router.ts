/**
 * StoredObjects tRPC router.
 *
 * Provides server-side existence probes for stored objects so the UI
 * does not need to issue raw `fetch` calls to /api/files/:id.  Auth is
 * inherited from the tRPC session, which avoids the CORS / credential
 * fragility of a native HEAD probe.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { checkProjectPermission } from "~/server/api/rbac";
import { StoredObjectsRepository } from "~/server/stored-objects/stored-objects.repository";

/**
 * Probes whether a stored object with the given id exists in the given project.
 *
 * Returns `{ exists: true, mediaType }` when the row is found, or
 * `{ exists: false }` when no row matches — the caller maps this to the
 * "missing" vs "error" distinction that was previously done with a
 * client-side HEAD fetch to /api/files/:id.
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
      const repository = new StoredObjectsRepository();
      const row = await repository.findById({ projectId, id });

      if (!row) {
        return { exists: false } as const;
      }

      return { exists: true, mediaType: row.media_type } as const;
    }),
});
