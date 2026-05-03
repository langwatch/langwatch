/**
 * tRPC router for personal-VK lifecycle.
 *
 * Distinct from `virtualKeysRouter` (which is project-scoped, RBAC-gated
 * via `virtualKeys:create`/`update`/etc.). Personal-VK procedures are
 * authorised by the caller being the owner of the personal workspace —
 * no project-level RBAC required because the personal project IS the
 * caller's by construction.
 */
import type { PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  PersonalVirtualKeyService,
  PersonalVirtualKeyNotFoundError,
  NoDefaultRoutingPolicyError,
} from "~/server/governance/personalVirtualKey.service";
import { PersonalWorkspaceService } from "~/server/governance/personalWorkspace.service";

import { checkOrganizationPermission } from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";

async function assertOrgMembership({
  prisma,
  userId,
  organizationId,
}: {
  prisma: PrismaClient;
  userId: string;
  organizationId: string;
}) {
  const membership = await prisma.organizationUser.findUnique({
    where: { userId_organizationId: { userId, organizationId } },
  });
  if (!membership) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Not a member of organization ${organizationId}`,
    });
  }
}

export const personalVirtualKeysRouter = createTRPCRouter({
  /**
   * List the caller's personal VKs in an organization. Never returns
   * the secret. Used by /me/settings to render the device list.
   */
  list: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .use(checkOrganizationPermission("organization:view"))
    .query(async ({ ctx, input }) => {
      await assertOrgMembership({
        prisma: ctx.prisma,
        userId: ctx.session.user.id,
        organizationId: input.organizationId,
      });
      const service = PersonalVirtualKeyService.create(ctx.prisma);
      const keys = await service.list({
        userId: ctx.session.user.id,
        organizationId: input.organizationId,
      });
      return keys;
    }),

  /**
   * Issue a new personal VK with the given label. Returns the secret
   * exactly once — caller must persist it immediately.
   *
   * Used by:
   *   - /me/settings "Add a new key" drawer (e.g. label="jane-laptop").
   *   - The CLI device-flow approval handler for the FIRST personal
   *     VK on first login (label="default").
   */
  issuePersonal: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        label: z
          .string()
          .min(1)
          .max(64)
          .regex(/^[a-z0-9][a-z0-9_\-]*$/, {
            message:
              "Label must be lowercase alphanumeric, dash, or underscore (no spaces)",
          }),
        routingPolicyId: z.string().optional(),
      }),
    )
    .use(checkOrganizationPermission("organization:view"))
    .mutation(async ({ ctx, input }) => {
      await assertOrgMembership({
        prisma: ctx.prisma,
        userId: ctx.session.user.id,
        organizationId: input.organizationId,
      });

      // Make sure the personal workspace exists (lazy backfill for users
      // who joined the org before we shipped this feature).
      const workspaceService = new PersonalWorkspaceService(ctx.prisma);
      const workspace = await workspaceService.ensure({
        userId: ctx.session.user.id,
        organizationId: input.organizationId,
        displayName: ctx.session.user.name,
        displayEmail: ctx.session.user.email,
      });

      // Reject duplicate labels at the application layer (the unique idx
      // is on (projectId, name) and would surface a P2002 anyway).
      const existing = await ctx.prisma.virtualKey.findFirst({
        where: {
          projectId: workspace.project.id,
          name: input.label,
          revokedAt: null,
        },
      });
      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `You already have a personal key labelled '${input.label}'`,
        });
      }

      const service = PersonalVirtualKeyService.create(ctx.prisma);
      let issued;
      try {
        issued = await service.issue({
          userId: ctx.session.user.id,
          organizationId: input.organizationId,
          personalProjectId: workspace.project.id,
          personalTeamId: workspace.team.id,
          label: input.label,
          routingPolicyId: input.routingPolicyId,
        });
      } catch (err) {
        // Spec contract — no_default_routing_policy maps to 409 so the
        // CLI / device-flow client can surface the actionable
        // "ask your admin to publish a default policy" message.
        if (err instanceof NoDefaultRoutingPolicyError) {
          throw new TRPCError({
            code: "CONFLICT",
            message: err.message,
            cause: err,
          });
        }
        throw err;
      }

      return {
        id: issued.virtualKey.id,
        label: issued.virtualKey.name,
        secret: issued.secret,
        baseUrl: issued.baseUrl,
        displayPrefix: issued.virtualKey.displayPrefix,
        routingPolicyId: issued.routingPolicyId,
      };
    }),

  /** Revoke one of the caller's personal VKs. Idempotent. */
  revokePersonal: protectedProcedure
    .input(z.object({ organizationId: z.string(), id: z.string() }))
    .use(checkOrganizationPermission("organization:view"))
    .mutation(async ({ ctx, input }) => {
      await assertOrgMembership({
        prisma: ctx.prisma,
        userId: ctx.session.user.id,
        organizationId: input.organizationId,
      });

      const service = PersonalVirtualKeyService.create(ctx.prisma);
      try {
        await service.revoke({
          userId: ctx.session.user.id,
          organizationId: input.organizationId,
          virtualKeyId: input.id,
        });
      } catch (err) {
        if (err instanceof PersonalVirtualKeyNotFoundError) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: err.message,
          });
        }
        throw err;
      }
      return { ok: true };
    }),
});
