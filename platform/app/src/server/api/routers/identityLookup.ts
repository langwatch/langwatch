import { auditLog } from "@ee/audit-log/auditLog";
import { normalizeIdentifierValue } from "@langwatch/identity";
import { z } from "zod";
import { identityLookup } from "~/server/app-layer/identity/runtime";
import { rateLimit } from "~/server/rateLimit";
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
 * How much of the trail one refused caller may write, in a window.
 *
 * A minute holds far more attempts than a mistake produces and far fewer than
 * a script does, which is the whole job: the trail keeps the evidence that
 * somebody tried, without the surface becoming a way to grow the table. The
 * limiter is shared with the other unauthenticated write paths and fails open
 * to a per-process budget, so a Redis outage narrows the bound rather than
 * removing the record.
 */
const REFUSED_ATTEMPT_WINDOW_SECONDS = 60;
const REFUSED_ATTEMPT_BUDGET = 10;

async function refusedAttemptBudget(userId: string): Promise<boolean> {
  const { allowed } = await rateLimit({
    key: `identity-lookup-attempt:${userId}`,
    windowSeconds: REFUSED_ATTEMPT_WINDOW_SECONDS,
    max: REFUSED_ATTEMPT_BUDGET,
  });
  return allowed;
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
  const isOperator = checkIsAdmin(user);

  // THE RECORD FIRST. This cross-organization lookup is itself the act, and
  // the refused attempt is the one the trail most needs to keep. The gate
  // still runs before any identity service read, so the caller learns
  // nothing about the address or even that this surface exists.
  //
  // A record written before the gate is also a row anybody signed in can
  // cause, carrying `args` they chose. So the attempts the gate is about to
  // refuse spend a budget: enough of them are kept that somebody pointed at
  // this surface who should not be is legible in the trail, and no more.
  // An OPERATOR IS NEVER THROTTLED — a support case is a burst of real
  // lookups, and a trail missing half of them is the thing this surface
  // exists to prevent.
  if (isOperator || (await refusedAttemptBudget(user.id))) {
    await auditLog({
      userId: user.id,
      action: `identityLookup.${action}`,
      args,
      targetKind: "identityLookup",
      targetId,
    });
  }
  // The refusal reads the same whether or not this attempt was one the budget
  // kept: being throttled tells a prober nothing the first refusal did not.
  if (!isOperator) throw adminSurfaceHidden();
  // Looking and repairing are one grant today. They are two fields because
  // they are two questions, and the surface asks the second one before it
  // renders a control rather than after somebody presses it.
  return { userId: user.id, canRepair: true };
}
