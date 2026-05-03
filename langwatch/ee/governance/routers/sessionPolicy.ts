// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Org-scoped governance policy — admin-tunable knobs flipped from
 * `/settings/governance`:
 *
 *   - `maxSessionDurationDays` (Phase 8): max lifetime of CLI/device
 *     sessions before re-login is required. 0 = unbounded.
 *   - `governanceLogContentMode` (Phase 9 "no-spy mode"): whether
 *     gateway-emitted gen_ai prompt/completion/system-instruction
 *     payloads land in ClickHouse. Values: full | strip_io | strip_all.
 *
 * Both surfaces share the same governance settings page and the same
 * RBAC posture (`organization:view` to read, `organization:manage` to
 * write), so co-location keeps the contract surface small without
 * coupling the underlying Prisma fields.
 *
 * Specs:
 *   - specs/ai-governance/sessions/personal-sessions.feature
 *   - specs/ai-governance/no-spy-mode/no-spy-mode.feature
 */
import { z } from "zod";

import { checkOrganizationPermission } from "~/server/api/rbac";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

const contentModeSchema = z.enum(["full", "strip_io", "strip_all"]);

export const sessionPolicyRouter = createTRPCRouter({
  get: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .use(checkOrganizationPermission("organization:view"))
    .query(async ({ ctx, input }) => {
      const org = await ctx.prisma.organization.findUnique({
        where: { id: input.organizationId },
        select: {
          maxSessionDurationDays: true,
          governanceLogContentMode: true,
        },
      });
      return {
        maxSessionDurationDays: org?.maxSessionDurationDays ?? 0,
        contentMode: contentModeSchema.parse(
          org?.governanceLogContentMode ?? "full",
        ),
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

  setContentMode: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        contentMode: contentModeSchema,
      }),
    )
    .use(checkOrganizationPermission("organization:manage"))
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.organization.update({
        where: { id: input.organizationId },
        data: { governanceLogContentMode: input.contentMode },
      });
      return { ok: true };
    }),
});
