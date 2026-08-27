import { auditLog } from "@ee/audit-log/auditLog";
import { normalizeIdentifierValue } from "@langwatch/identity";
import { z } from "zod";
import { identityLookup } from "~/server/app-layer/identity/identity-lookup-runtime";
import { adminSurfaceHidden } from "../../../../ee/admin/adminSurfaceHidden";
import { isAdmin as checkIsAdmin } from "../../../../ee/admin/isAdmin";
import { createTRPCRouter, protectedProcedure } from "../trpc";

/**
 * The platform operator's identity lookup (D05).
 *
 * THE READ IS ITSELF THE ACT. Resolving an address here crosses every
 * organization on the installation, so the record is written BEFORE the
 * authorization check rather than after the answer — an attempt by somebody
 * who may not look is exactly the thing an audit trail exists to hold, and
 * one written after the gate would hold only the attempts that succeeded.
 * That ordering is the one thing about this surface with no equivalent
 * anywhere else in the back office, where reads pass unrecorded.
 *
 * Everything else is the back office's existing grammar, unchanged: the
 * `ADMIN_EMAILS` staff list rather than `ops:*` (widening who may see the
 * ops pages must not widen who may repair somebody's sign-in), a 404 built
 * from `AdminSurfaceHiddenError` so the surface does not confirm its own
 * existence to a prober, and one audit row per act with the operator on it.
 *
 * The guards underneath refuse a second time and differently. Nothing here
 * decides whether a detach would strand somebody, whether a proposal was
 * already decided, or whether an invitation may be resent — those live in
 * the commands, and they hold for callers that never came through here.
 */

const NO_PERMISSION = {
  reason:
    "back-office surface gated on the ADMIN_EMAILS staff list, not on an RBAC permission; cross-organization by design",
} as const;

/**
 * The same opt-out for the two verbs whose input names an organization.
 *
 * The justification is the important half: the id is NOT what decides the
 * caller's reach here. An operator on the staff list may act on any
 * organization and one who is not may act on none — so `organizationId` is
 * routing, saying whose invitation the command touches, and it is never read
 * as a scope the caller was granted.
 *
 * A `userId` needs no entry: the declaration is about SCOPE ids, and a person
 * is not a scope anything is granted at. The reasoning is the same either
 * way, and it is written down beside the verbs that carry one.
 */
const NO_PERMISSION_FOR_ORGANIZATION = {
  ...NO_PERMISSION,
  allow: {
    organizationId:
      "names the tenant whose invitation the command touches; the caller's reach is the ADMIN_EMAILS staff list and is never derived from this id",
  },
} as const;

/** The address as a support case arrives holding it. */
const addressInput = z.string().min(1).max(254);

export const identityLookupRouter = createTRPCRouter({
  resolve: protectedProcedure
    .input(z.object({ address: addressInput }))
    .noPermission(NO_PERMISSION)
    .query(async ({ ctx, input }) => {
      const operator = await recorded({
        ctx,
        action: "resolve",
        args: { address: normalizeIdentifierValue(input.address) },
      });
      return {
        ...(await identityLookup().resolve({ address: input.address })),
        // What this operator may DO, resolved once on the server. A control
        // rendered and then refused when pressed is a worse answer than one
        // that was never offered.
        canRepair: operator.canRepair,
      };
    }),

  person: protectedProcedure
    .input(z.object({ userId: z.string().min(1), address: addressInput }))
    .noPermission(NO_PERMISSION)
    .query(async ({ ctx, input }) => {
      await recorded({
        ctx,
        action: "person",
        args: {
          userId: input.userId,
          address: normalizeIdentifierValue(input.address),
        },
        targetId: input.userId,
      });
      return identityLookup().person(input);
    }),

  recentActivity: protectedProcedure
    .input(z.object({}))
    .noPermission(NO_PERMISSION)
    .query(async ({ ctx }) => {
      await recorded({ ctx, action: "recentActivity", args: {} });
      return identityLookup().recentActivity();
    }),

  claimQueue: protectedProcedure
    .input(z.object({}))
    .noPermission(NO_PERMISSION)
    .query(async ({ ctx }) => {
      await recorded({ ctx, action: "claimQueue", args: {} });
      return identityLookup().claimQueue();
    }),

  confirmProposedSignIn: protectedProcedure
    .input(
      z.object({
        userId: z.string().min(1),
        proposalId: z.string().min(1),
      }),
    )
    .noPermission(NO_PERMISSION)
    .mutation(async ({ ctx, input }) => {
      const operator = await recorded({
        ctx,
        action: "confirmProposedSignIn",
        args: input,
        targetId: input.userId,
      });
      await identityLookup().confirmProposedSignIn({ ...input, operator });
    }),

  rejectProposedSignIn: protectedProcedure
    .input(
      z.object({
        userId: z.string().min(1),
        proposalId: z.string().min(1),
      }),
    )
    .noPermission(NO_PERMISSION)
    .mutation(async ({ ctx, input }) => {
      const operator = await recorded({
        ctx,
        action: "rejectProposedSignIn",
        args: input,
        targetId: input.userId,
      });
      await identityLookup().rejectProposedSignIn({ ...input, operator });
    }),

  detachMethod: protectedProcedure
    .input(
      z.object({
        userId: z.string().min(1),
        identifierId: z.string().min(1),
      }),
    )
    .noPermission(NO_PERMISSION)
    .mutation(async ({ ctx, input }) => {
      const operator = await recorded({
        ctx,
        action: "detachMethod",
        args: input,
        targetId: input.userId,
      });
      await identityLookup().detachMethod({ ...input, operator });
    }),

  endSessions: protectedProcedure
    .input(
      z.object({
        userId: z.string().min(1),
        /** Null ends every session; an id ends one method's. */
        identifierId: z.string().min(1).nullable().default(null),
      }),
    )
    .noPermission(NO_PERMISSION)
    .mutation(async ({ ctx, input }) => {
      await recorded({
        ctx,
        action: "endSessions",
        args: input,
        targetId: input.userId,
      });
      await identityLookup().endSessions(input);
    }),

  resendInvitation: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        inviteId: z.string().min(1),
      }),
    )
    .noPermission(NO_PERMISSION_FOR_ORGANIZATION)
    .mutation(async ({ ctx, input }) => {
      await recorded({
        ctx,
        action: "resendInvitation",
        args: input,
        targetId: input.inviteId,
      });
      return identityLookup().resendInvitation(input);
    }),

  extendInvitation: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        inviteId: z.string().min(1),
      }),
    )
    .noPermission(NO_PERMISSION_FOR_ORGANIZATION)
    .mutation(async ({ ctx, input }) => {
      await recorded({
        ctx,
        action: "extendInvitation",
        args: input,
        targetId: input.inviteId,
      });
      return identityLookup().extendInvitation(input);
    }),
});

export interface RecordedOperator {
  userId: string;
  /** Whether this operator may repair, not only look. */
  canRepair: boolean;
}

/**
 * Record the act, then decide whether it was allowed.
 *
 * The order is the point. Every other back-office procedure gates first and
 * records after, which is right where the record is about a change that
 * happened. Here the record is about an ATTEMPT to reach across every
 * organization on the installation, and an attempt that was refused is the
 * one most worth keeping.
 *
 * The row is written against whoever asked — the impersonator when there is
 * one, because "acting as" somebody else is not who resolved the address.
 */
async function recorded({
  ctx,
  action,
  args,
  targetId,
}: {
  ctx: {
    session: {
      user: {
        id: string;
        email?: string | null;
        impersonator?: { id: string; email?: string | null } | null;
      };
    };
  };
  action: string;
  args: Record<string, unknown>;
  targetId?: string;
}): Promise<RecordedOperator> {
  const user = ctx.session.user.impersonator ?? ctx.session.user;
  // THE GATE FIRST. A refused stranger has not looked anybody up, so there is
  // nothing about them to record — and writing the row before the check made
  // this an unauthenticated-by-permission writer into `AuditLog`: any signed-
  // in customer could call `identityLookup.resolve` in a loop and fill the
  // operator's own activity panel with strings they chose, since
  // `findRecentOperatorActivity` reads those rows straight back by prefix.
  // The sibling `scimOversight` recorder already does it in this order.
  if (!checkIsAdmin(user)) throw adminSurfaceHidden();
  await auditLog({
    userId: user.id,
    action: `identityLookup.${action}`,
    args,
    targetKind: "identityLookup",
    targetId,
  });
  // Looking and repairing are one grant today. They are two fields because
  // they are two questions, and the surface asks the second one before it
  // renders a control rather than after somebody presses it.
  return { userId: user.id, canRepair: true };
}
