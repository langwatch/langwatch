/**
 * tRPC router for the per-project Langy egress allow-list (ADR-043).
 *
 *   get — the current allow-list for the settings editor. `null` means the
 *         project is in monitor-only mode (watch, never block).
 *   set — replaces the allow-list. An empty array clears it back to
 *         monitor-only. Gated on `project:update` — this is a project network
 *         policy, not per-user state.
 *
 * The enforcement path is the credentials envelope + the agent's egress
 * adapter (see LangyCredentialService.getEgressAllowlist and
 * services/langyagent/adapters/egress/adapter.go). This router is only how a
 * customer reads and sets the value; a change takes effect on the
 * conversation's next turn (the worker recycles when its egress signature
 * changes).
 */

import { z } from "zod";
import { checkProjectPermission } from "~/server/api/rbac";
import { auditLog } from "~/server/auditLog";
import {
  langyEgressAllowlistSchema,
  LangyCredentialService,
} from "~/server/services/langy/LangyCredentialService";
import { createTRPCRouter, protectedProcedure } from "../trpc";

export const langyEgressRouter = createTRPCRouter({
  get: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkProjectPermission("project:view"))
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
    .use(checkProjectPermission("project:update"))
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
