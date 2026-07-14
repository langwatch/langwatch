// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Org-scoped governance policy — admin-tunable knobs flipped from
 * `/settings/governance`:
 *
 *   - `maxSessionDurationDays` (Phase 8): max lifetime of CLI/device
 *     sessions before re-login is required. 0 = unbounded.
 *
 * This surface shares the governance settings page and the RBAC posture
 * (`organization:view` to read, `organization:manage` to write).
 *
 * Specs:
 *   - specs/ai-governance/sessions/personal-sessions.feature
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
        select: {
          maxSessionDurationDays: true,
        },
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
