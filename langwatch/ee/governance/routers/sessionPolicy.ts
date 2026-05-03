/**
 * Org-scoped session policy — admin-tunable knobs that govern how long
 * CLI/device sessions stay alive. Read by `/exchange` to compute the
 * refresh-token TTL ceiling; written by the admin from the governance
 * settings page.
 *
 * Field today: `maxSessionDurationDays` (0 = unbounded).
 *
 * Phase 9 will sibling-add `governanceLogContentMode` here once
 * Sergey's content-strip backend lands. Keeping the router scoped to
 * "things admins flip on the org" makes future additions cheap.
 *
 * Spec: specs/ai-governance/sessions/personal-sessions.feature
 *       (Scenario: maxSessionDurationDays caps refresh-token TTL)
 */
import { z } from "zod";

import { checkOrganizationPermission } from "~/server/api/rbac";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

export const sessionPolicyRouter = createTRPCRouter({
  get: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .use(checkOrganizationPermission("organization:view"))
    .query(async ({ ctx, input }) => {
      const org = await ctx.prisma.organization.findUnique({
        where: { id: input.organizationId },
        select: { maxSessionDurationDays: true },
      });
      return {
        maxSessionDurationDays: org?.maxSessionDurationDays ?? 0,
      };
    }),

  setMaxDuration: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        // 0 = unbounded; cap at 365 to avoid silent-typo "set to 9999".
        // The /exchange path treats > 0 as a hard ceiling on refresh
        // TTL, so values higher than the refresh-token's natural life
        // (~30d) just no-op.
        maxSessionDurationDays: z.number().int().min(0).max(365),
      }),
    )
    .use(checkOrganizationPermission("organization:manage"))
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.organization.update({
        where: { id: input.organizationId },
        data: { maxSessionDurationDays: input.maxSessionDurationDays },
      });
      return { ok: true };
    }),
});
