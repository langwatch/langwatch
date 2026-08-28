import { DOMAIN_JOIN_SETTINGS, type JoinLookupDecision } from "@langwatch/identity";
import { z } from "zod";
import type { PrismaClient } from "~/generated/prisma/client";
import { createTRPCRouter, protectedProcedure, type TRPCContext } from "~/server/api/trpc";
import { identityEmail, joinRequestsService } from "~/server/app-layer/identity/runtime";

/**
 * Joining an organization (D12, ADR-117): the lookup, the ask, the two admin
 * answers, and the setting behind them.
 *
 * The reveal discipline is the whole design of this file, and it is enforced
 * by what the procedures ACCEPT rather than by what they return.
 *
 * `lookup` takes NO address. It reads the caller's own verified identifiers
 * and answers about those, so there is no input a caller can vary to probe
 * for other people's organizations — the one shape that makes this endpoint
 * safe to expose at all. `request` re-derives the offer server-side for the
 * same reason: naming an organization that was never offered is refused
 * exactly as an organization that does not exist is, and both come back as
 * `join_not_available`.
 *
 * The requester-side procedures use `.noPermission()` deliberately. There is
 * no permission to hold — the caller is asking to join an organization they
 * are by definition not in yet — so the handler proves what it needs itself:
 * the address is the session's own and verified, and the organization is one
 * the matcher offered. The admin-side procedures take `organization:manage`,
 * the same permission that gates inviting, because approving a request and
 * sending an invitation are the same authority.
 */
export const joinRequestsRouter = createTRPCRouter({
  /**
   * Which organizations are open to one of the caller's own verified
   * addresses. Answers `{ outcome: "none" }` for every closed door — an
   * unverified address, a consumer mail domain, an organization that turned
   * joining off, and one that does not exist are all one answer.
   */
  lookup: protectedProcedure
    .noPermission({
      reason:
        "the caller is asking about organizations they are not in yet, so there is no scope to hold a permission on; the handler answers only for the session's OWN verified addresses and reveals nothing else",
    })
    .query(async ({ ctx }): Promise<JoinLookupDecision> => {
      const verifiedEmail = await verifiedEmailFor({
        prisma: ctx.prisma,
        userId: ctx.session.user.id,
      });
      return joinRequests(ctx).lookup({
        userId: ctx.session.user.id,
        verifiedEmail,
      });
    }),

  /** Everything this person is waiting on, so a screen can say so rather
   *  than offering them an organization they have already asked. */
  mine: protectedProcedure
    .noPermission({
      reason: "the caller's own pending requests, keyed by their session id",
    })
    .query(async ({ ctx }) => {
      const pending = await joinRequests(ctx).pendingForUser({
        userId: ctx.session.user.id,
      });
      return pending.map((request) => ({
        joinRequestId: request.joinRequestId,
        organizationId: request.organizationId,
        requestedAt: new Date(request.createdAtMs),
        expiresAt: request.expiresAtMs === null ? null : new Date(request.expiresAtMs),
      }));
    }),

  /** Ask one organization to let you in. */
  request: protectedProcedure
    .input(z.object({ organizationId: z.string().min(1) }))
    .noPermission({
      reason:
        "asking to join is the one action a non-member takes on an organization; the handler proves the organization was OFFERED to this caller's verified domain and refuses anything else as if it did not exist",
      allow: { organizationId: "the organization the matcher offered" },
    })
    .mutation(async ({ ctx, input }) => {
      const verifiedEmail = await verifiedEmailFor({
        prisma: ctx.prisma,
        userId: ctx.session.user.id,
      });
      return joinRequests(ctx).request({
        userId: ctx.session.user.id,
        verifiedEmail,
        organizationId: input.organizationId,
      });
    }),

  /** Give up on a request, so nobody is bothered further. */
  withdraw: protectedProcedure
    .input(z.object({ joinRequestId: z.string().min(1) }))
    .noPermission({
      // No `allow` map: `joinRequestId` is not a scope id, and the handler
      // refuses a request that is not the caller's as if it did not exist.
      reason: "the requester withdrawing their own request, matched on the session's user id",
    })
    .mutation(async ({ ctx, input }) => {
      await joinRequests(ctx).withdraw({
        joinRequestId: input.joinRequestId,
        userId: ctx.session.user.id,
      });
      return { success: true };
    }),

  /** What is waiting on this organization, for the members area. */
  pending: protectedProcedure
    .input(z.object({ organizationId: z.string().min(1) }))
    .permission("organization:manage")
    .query(async ({ ctx, input }) => {
      const pending = await joinRequests(ctx).pendingForOrganization({
        organizationId: input.organizationId,
      });
      // Who is asking, by name. The requester's ADDRESS is deliberately not
      // returned: the domain is what was matched and what the admin is
      // deciding on, and the local part is not the organization's business
      // until the person is a member.
      const names = await ctx.prisma.user.findMany({
        where: { id: { in: pending.map((request) => request.userId) } },
        select: { id: true, name: true },
      });
      const nameById = new Map(names.map((user) => [user.id, user.name]));

      return pending.map((request) => ({
        joinRequestId: request.joinRequestId,
        userId: request.userId,
        name: nameById.get(request.userId) ?? "A colleague",
        domain: request.domain,
        requestedAt: new Date(request.createdAtMs),
        expiresAt: request.expiresAtMs === null ? null : new Date(request.expiresAtMs),
      }));
    }),

  /**
   * Approve. No role on this input and never will be: an approval grants the
   * organization's default role, and an admin who wants to hand over more
   * sends a formal invitation, which is the flow that owns roles and teams.
   */
  approve: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        joinRequestId: z.string().min(1),
      }),
    )
    .permission("organization:manage")
    .mutation(async ({ ctx, input }) => {
      await joinRequests(ctx).approve({
        joinRequestId: input.joinRequestId,
        organizationId: input.organizationId,
        adminUserId: ctx.session.user.id,
      });
      return { success: true };
    }),

  /** Reject. No reason field: an admin who has to justify a refusal is an
   *  admin who hesitates to make one. */
  reject: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        joinRequestId: z.string().min(1),
      }),
    )
    .permission("organization:manage")
    .mutation(async ({ ctx, input }) => {
      await joinRequests(ctx).reject({
        joinRequestId: input.joinRequestId,
        organizationId: input.organizationId,
        adminUserId: ctx.session.user.id,
      });
      return { success: true };
    }),

  /** How colleagues on a matching domain currently get in, for the settings
   *  card. Behind `organization:manage` like the write: an organization's
   *  joining posture is not a stranger's business. */
  joining: protectedProcedure
    .input(z.object({ organizationId: z.string().min(1) }))
    .permission("organization:manage")
    .query(async ({ ctx, input }) => {
      return joinRequests(ctx).readJoining({
        organizationId: input.organizationId,
      });
    }),

  /** How colleagues on a matching domain get in. */
  setJoining: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        domainJoin: z.enum(DOMAIN_JOIN_SETTINGS),
        domains: z.array(z.string().min(1)).default([]),
      }),
    )
    .permission("organization:manage")
    .mutation(async ({ ctx, input }) => {
      return joinRequests(ctx).setJoining({
        organizationId: input.organizationId,
        domainJoin: input.domainJoin,
        domains: input.domains,
      });
    }),
});

function joinRequests(ctx: Pick<TRPCContext, "app">) {
  return joinRequestsService({
    authzGrants: ctx.app.authzGrants,
    featureFlags: ctx.app.featureFlags,
    mailer: ctx.app.mailer,
  });
}

/**
 * The caller's own verified address, and the reason every procedure above
 * starts here.
 *
 * `verifiedEmailsOf` answers `null` for a user who is not on identifiers yet,
 * which is the legacy fallback the rest of the identity surface uses: the
 * `User.email` column, but only where better-auth has marked it verified. An
 * unverified address answers null, and every caller treats that as the
 * universal nothing.
 */
async function verifiedEmailFor({
  prisma,
  userId,
}: {
  prisma: PrismaClient;
  userId: string;
}): Promise<string | null> {
  const verified = await identityEmail().verifiedEmailsOf({ userId });
  if (verified !== null) return verified[0]?.value ?? null;

  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, emailVerified: true },
  });
  return row?.emailVerified ? (row.email ?? null) : null;
}
