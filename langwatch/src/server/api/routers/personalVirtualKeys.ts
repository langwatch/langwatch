/**
 * tRPC router for personal-VK lifecycle.
 *
 * Distinct from `virtualKeysRouter` (which gates org-wide VK admin via
 * `virtualKeys:manage` / `:rotate` / `:delete`). Personal-VK procedures
 * are authorised by the caller being the principal user of the key, not
 * by RBAC — every user can mint, list, and revoke their OWN keys in any
 * org they belong to. Membership is verified via `assertOrgMembership`
 * so a user can't operate against an org they aren't in.
 */
import type { PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  PersonalVirtualKeyService,
  PersonalVirtualKeyNotFoundError,
  NoEligibleProvidersError,
  RoutingPolicyHasNoProvidersError,
} from "@ee/governance/services/personalVirtualKey.service";
import { PersonalWorkspaceService } from "@ee/governance/services/personalWorkspace.service";
import { env } from "~/env.mjs";

import {
  authorizeInResolver,
  checkOrganizationPermission,
  hasOrganizationPermission,
} from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";

/**
 * Service options for VK lifecycle calls. Forwards the gateway-URL
 * env signal so the service can pick the right default for the
 * deployment shape: explicit `LW_GATEWAY_BASE_URL` always wins,
 * otherwise SaaS gets `gateway.langwatch.ai` and self-hosted falls
 * back to `http://localhost:5563` (the Docker port the AI gateway
 * binds to). Without this, fresh self-hosted installs displayed the
 * production gateway URL on the VK reveal card and the user's curl
 * routed to the wrong place (Ariana QA option-C dogfood finding).
 */
const gatewayUrlOptions = () => ({
  // LW_GATEWAY_PUBLIC_URL is the unambiguous TS-side public-URL var.
  // LW_GATEWAY_BASE_URL is the legacy fallback — kept for SaaS deploys
  // where the value still carried the public URL before the Go gateway
  // started hijacking the same name for control-plane discovery.
  gatewayBaseUrl: env.LW_GATEWAY_PUBLIC_URL ?? env.LW_GATEWAY_BASE_URL,
  isSaas: env.IS_SAAS,
});

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
   * List personal VKs in an organization. Never returns the secret.
   *
   * Default surface (/me/configure device list) lists the caller's own
   * keys — the principal-user match bypasses any `virtualKeys:view` check.
   * An org admin holding `virtualKeys:viewOtherPersonal` can audit another
   * user's keys via `targetUserId`, or sweep every member's keys by
   * omitting it. Membership-based visibility runs in the resolver, so the
   * builder's fail-closed gate is satisfied by authorizeInResolver.
   */
  list: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        targetUserId: z.string().optional(),
      }),
    )
    .use(authorizeInResolver)
    .query(async ({ ctx, input }) => {
      await assertOrgMembership({
        prisma: ctx.prisma,
        userId: ctx.session.user.id,
        organizationId: input.organizationId,
      });

      const callerId = ctx.session.user.id;
      // Resolve which principal(s) the result is scoped to. Own keys are
      // always visible; anything wider needs viewOtherPersonal.
      let principalUserId: string | undefined;
      if (input.targetUserId === callerId) {
        principalUserId = callerId;
      } else {
        const canViewOthers = await hasOrganizationPermission(
          { prisma: ctx.prisma, session: ctx.session },
          input.organizationId,
          "virtualKeys:viewOtherPersonal",
        );
        if (input.targetUserId !== undefined) {
          if (!canViewOthers) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "permission_denied: virtualKeys:viewOtherPersonal",
            });
          }
          principalUserId = input.targetUserId;
        } else {
          // No target: an admin sweeps the whole org, a plain member sees
          // only their own keys.
          principalUserId = canViewOthers ? undefined : callerId;
        }
      }

      const service = PersonalVirtualKeyService.create(ctx.prisma, {
        ...gatewayUrlOptions(),
      });
      const keys = await service.list({
        userId: principalUserId,
        organizationId: input.organizationId,
      });
      return keys;
    }),

  /**
   * Issue a new personal VK with the given label. Returns the secret
   * exactly once — caller must persist it immediately.
   *
   * Used by:
   *   - /me/configure "Add a new key" drawer (e.g. label="jane-laptop").
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

      // Reject duplicate labels at the application layer. Post-iter-110
      // VirtualKey is org-scoped; the (organizationId, principalUserId,
      // name) tuple is the personal-VK uniqueness contract (multiple
      // users in the same org can each have a "default" key, but the
      // same user cannot have two active "default" keys in one org).
      const existing = await ctx.prisma.virtualKey.findFirst({
        where: {
          organizationId: input.organizationId,
          principalUserId: ctx.session.user.id,
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

      const service = PersonalVirtualKeyService.create(ctx.prisma, {
        ...gatewayUrlOptions(),
      });
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
        // Default-resolution path with zero accessible providers — the
        // user genuinely has nothing to route through. Map to 409 so
        // the CLI / /me UI can surface the actionable "ask your admin
        // to add a provider" message at mint time instead of letting
        // the user discover the gap via a copy-pasted curl that 504s.
        if (err instanceof NoEligibleProvidersError) {
          throw new TRPCError({
            code: "CONFLICT",
            message: err.message,
            cause: err,
          });
        }
        // G34 — empty routing policy (provider list is []) when the
        // caller explicitly pinned that policy. Mapping to 422
        // (UNPROCESSABLE_CONTENT) — the request is syntactically fine
        // but the pinned policy does not yet support processing it.
        if (err instanceof RoutingPolicyHasNoProvidersError) {
          throw new TRPCError({
            code: "UNPROCESSABLE_CONTENT",
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

      const service = PersonalVirtualKeyService.create(ctx.prisma, {
        ...gatewayUrlOptions(),
      });
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
