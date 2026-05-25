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
 *   - `governanceAccountErrorMessage`: the message end users see when the
 *     gateway blocks a request for an account-level reason they cannot
 *     self-resolve (org gateway spending limit reached, or the org's
 *     provider account exhausted). Empty = forward the provider's verbatim
 *     error unchanged (the bug-33 transparency default); the gateway only
 *     swaps the human-facing message when this is set, preserving status +
 *     error type + retry headers so client retry semantics are unchanged.
 *
 * All three surfaces share the same governance settings page and the same
 * RBAC posture (`organization:view` to read, `organization:manage` to
 * write), so co-location keeps the contract surface small without
 * coupling the underlying Prisma fields.
 *
 * Specs:
 *   - specs/ai-governance/sessions/personal-sessions.feature
 *   - specs/ai-governance/no-spy-mode/no-spy-mode.feature
 *   - specs/ai-gateway/governance/governance-error-messaging.feature
 */
import { z } from "zod";

import { checkOrganizationPermission } from "~/server/api/rbac";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

const contentModeSchema = z.enum(["full", "strip_io", "strip_all"]);

// Cap the admin-set governance message so a typo can't ship a multi-KB
// string into every gateway bundle. 500 chars is ample for a "contact your
// admin" line with a support channel reference.
const ACCOUNT_ERROR_MESSAGE_MAX = 500;

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
          governanceAccountErrorMessage: true,
        },
      });
      return {
        maxSessionDurationDays: org?.maxSessionDurationDays ?? 0,
        contentMode: contentModeSchema.parse(
          org?.governanceLogContentMode ?? "full",
        ),
        accountErrorMessage: org?.governanceAccountErrorMessage ?? "",
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

  setAccountErrorMessage: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        // Empty string clears the override → store NULL → the gateway
        // resumes verbatim provider-error passthrough.
        message: z.string().max(ACCOUNT_ERROR_MESSAGE_MAX),
      }),
    )
    // Purpose-built org-governance resource: lets a custom role delegate
    // governance management without granting full `organization:manage`.
    // ADMIN holds it by default; MEMBER + EXTERNAL do not.
    .use(checkOrganizationPermission("governance:manage"))
    .mutation(async ({ ctx, input }) => {
      const trimmed = input.message.trim();
      await ctx.prisma.organization.update({
        where: { id: input.organizationId },
        data: { governanceAccountErrorMessage: trimmed === "" ? null : trimmed },
      });
      return { ok: true };
    }),
});
