// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * tRPC router for per-tool path policy: the org admin toggles which
 * `langwatch <tool>` paths (gateway / VK vs direct OTLP) the CLI may use.
 * Reads gate on `governance:view`, writes on `governance:manage`.
 *
 * Spec: specs/ai-gateway/governance/cli-tool-mode-policy.feature
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  PLATFORM_TOOL_SLUGS,
  PlatformToolPolicyService,
  UnknownPlatformToolError,
} from "@ee/governance/services/platformToolPolicy.service";

import { checkOrganizationPermission } from "~/server/api/rbac";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

const toolSlugSchema = z.enum(PLATFORM_TOOL_SLUGS);

export const platformToolPolicyRouter = createTRPCRouter({
  list: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .use(checkOrganizationPermission("governance:view"))
    .query(async ({ ctx, input }) => {
      return await PlatformToolPolicyService.create(ctx.prisma).getForOrg({
        organizationId: input.organizationId,
      });
    }),

  update: protectedProcedure
    .input(
      z
        .object({
          organizationId: z.string(),
          toolSlug: toolSlugSchema,
          allowVk: z.boolean().optional(),
          allowOtelDirect: z.boolean().optional(),
        })
        .refine(
          (v) => v.allowVk !== undefined || v.allowOtelDirect !== undefined,
          { message: "At least one of allowVk or allowOtelDirect is required" },
        ),
    )
    .use(checkOrganizationPermission("governance:manage"))
    .mutation(async ({ ctx, input }) => {
      try {
        return await PlatformToolPolicyService.create(ctx.prisma).update({
          organizationId: input.organizationId,
          toolSlug: input.toolSlug,
          allowVk: input.allowVk,
          allowOtelDirect: input.allowOtelDirect,
          callerUserId: ctx.session.user.id,
        });
      } catch (err) {
        if (err instanceof UnknownPlatformToolError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
        }
        throw err instanceof TRPCError
          ? err
          : new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: String(err),
            });
      }
    }),
});
