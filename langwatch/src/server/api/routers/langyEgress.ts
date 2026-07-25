/**
 * tRPC router for the per-project Langy egress allow-list (ADR-043).
 *
 *   get — the current allow-list for the settings editor. `null` means the
 *         project is in monitor-only mode (watch, never block).
 *   set — replaces the allow-list. An empty array clears it back to
 *         monitor-only. Gated on `langy:manage` — this is a project network
 *         policy, not per-user state.
 *
 * The enforcement path is the credentials envelope + the agent's egress
 * adapter (see LangyCredentialService.getEgressAllowlist and
 * app-layer/langyagent/adapters/egress/adapter.go). This router is only how a
 * customer reads and sets the value; a change takes effect on the
 * conversation's next turn (the worker recycles when its egress signature
 * changes).
 *
 * Both procedures sit behind the authoritative Langy internal-only gate
 * (`enforceLangyAccess`) as well as their `langy:*` permission — this is Langy
 * config, so it stays dark for accounts that don't have Langy.
 *
 * They also refuse the demo project, mirroring `langy.ts`. These used to read
 * `project:view` / `project:update`, and `project:view` is granted to EVERY
 * authenticated user on the demo project (DEMO_VIEW_PERMISSIONS), so `get` was
 * exposing the demo project's egress allow-list — the set of hosts Langy's
 * sandbox may reach — to anyone with an account. `langy:*` is not demo-granted,
 * and the explicit refusal keeps it that way if that ever changes.
 */

import { z } from "zod";
import { checkProjectPermission } from "~/server/api/rbac";
import { auditLog } from "~/server/auditLog";
import {
  langyEgressAllowlistSchema,
  LangyCredentialService,
} from "~/server/app-layer/langy/LangyCredentialService";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import {
  enforceLangyAccess,
  refuseDemoProject,
} from "./langyAccessMiddleware";

export const langyEgressRouter = createTRPCRouter({
  get: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkProjectPermission("langy:view"))
    .use(refuseDemoProject)
    .use(enforceLangyAccess)
    .query(async ({ ctx, input }) => {
      const service = LangyCredentialService.create(ctx.prisma);
      const allowlist = await service.getEgressAllowlist({
        projectId: input.projectId,
      });
      // `null` ⇒ monitor-only. The editor renders an empty list + the
      // "leave empty to watch without blocking" hint in that state.
      return { allowlist: allowlist ?? [], enforcing: allowlist !== null };
    }),

  set: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        allowlist: langyEgressAllowlistSchema,
      }),
    )
    .use(checkProjectPermission("langy:manage"))
    .use(refuseDemoProject)
    .use(enforceLangyAccess)
    .mutation(async ({ ctx, input }) => {
      const service = LangyCredentialService.create(ctx.prisma);
      const saved = await service.setEgressAllowlist({
        projectId: input.projectId,
        allowlist: input.allowlist,
      });
      await auditLog({
        userId: ctx.session.user.id,
        projectId: input.projectId,
        action: "langy.egress.setAllowlist",
        // The host list travels further than the UI (SIEM, tickets); log only
        // its shape, mirroring how langy.ts logs the model allow-list.
        metadata: { entryCount: saved?.length ?? 0, enforcing: saved !== null },
      });
      return { allowlist: saved ?? [], enforcing: saved !== null };
    }),
});
