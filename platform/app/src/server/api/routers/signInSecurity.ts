import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import {
  forgetSignInSecurityPolicies,
  sessionBound,
  signInLockout,
  signInSecurityMembership,
  signInSecurityReleaseEvidence,
  signInSecuritySessions,
  signInSecuritySettings,
} from "~/server/app-layer/identity/runtime";
import {
  assertSessionWindowSensible,
  releaseHeldAccount,
  sweepSessionsPastWindow,
  willActivateSignInSecurity,
} from "~/server/app-layer/identity/sign-in-security-settings";
import { assertEnterprisePlan, ENTERPRISE_FEATURE_ERRORS } from "../enterprise";

/**
 * The two sign-in security rules an organization can set: locking an account
 * after repeated failures (GAC-09) and bounding how long a browser session
 * lasts (GAC-10).
 *
 * Follows `sessionPolicy.ts`'s shape (`@ee/governance/routers/sessionPolicy`):
 * a thin router over the composed identity ports and services from
 * `runtime.ts`, with the sweep-on-save and release logic as their own tested
 * module (`sign-in-security-settings.ts`) rather than inline in the mutation
 * — the same split that module keeps with `applySessionCeiling`. No Prisma
 * is named here or in that module; every read and write goes through a port
 * implemented in `sign-in-security-adapters.ts` and composed in `runtime.ts`
 * (`identity-service-layering.unit.test.ts` enforces this tree-wide).
 *
 * `get` takes `organization:view`; `save` and `release` take
 * `organization:manage` — the same split `sessionPolicy.ts` and
 * `twoStepVerification.setRequirement` both use for an organization-wide
 * security setting.
 *
 * Mounted unconditionally, on every plan (the established pattern:
 * `organizationMfa()` in `runtime.ts`). Entitlement is refused per
 * organization, inside `save`, and only for the write that turns a rule ON
 * from fully off — see `willActivateSignInSecurity`. A control that is
 * unreachable by unmounting the route cannot be told apart from a control
 * that does not exist; a control that is refused with the plan's name can.
 *
 * Specs: specs/identity/org-account-lockout.feature,
 * specs/identity/org-session-lifetime.feature.
 */

const settingsInput = z.object({
  organizationId: z.string().min(1),
  /** Consecutive failures before a lock. 0 = never lock. */
  lockoutAfterFailedAttempts: z.number().int().min(0).max(20),
  /** How long a lock lasts, in minutes. */
  lockoutMinutes: z.number().int().min(1).max(1440),
  /** Minutes a session may sit idle before it ends. 0 = no idle timeout. */
  sessionIdleTimeoutMinutes: z.number().int().min(0).max(10080),
  /** Minutes from sign-in after which a session ends regardless of activity.
   *  0 = no ceiling. Capped at a week, the same ceiling the idle timeout
   *  carries — a longer number is not a real security bound. */
  sessionMaxLifetimeMinutes: z.number().int().min(0).max(10080),
});

export const signInSecurityRouter = createTRPCRouter({
  get: protectedProcedure
    .input(z.object({ organizationId: z.string().min(1) }))
    .permission("organization:view")
    .query(async ({ input }) =>
      signInSecuritySettings().read({ organizationId: input.organizationId }),
    ),

  save: protectedProcedure
    .input(settingsInput)
    .permission("organization:manage")
    .mutation(async ({ ctx, input }) => {
      const { organizationId, ...next } = input;
      assertSessionWindowSensible(next);

      const settings = signInSecuritySettings();
      const current = await settings.read({ organizationId });
      if (willActivateSignInSecurity({ current, next })) {
        await assertEnterprisePlan({
          organizationId,
          user: ctx.session.user,
          errorMessage: ENTERPRISE_FEATURE_ERRORS.SIGN_IN_SECURITY,
        });
      }

      await settings.write({ organizationId, settings: next });
      // Both cached "does anybody on this installation set one of these"
      // answers are stale the moment this write lands - forgotten so the
      // organization that just saved is never held to the answer it had
      // thirty seconds ago.
      forgetSignInSecurityPolicies();

      const sweptSessions = await sweepSessionsPastWindow({
        organizationId,
        sessions: signInSecuritySessions(),
        sessionBound: sessionBound(),
      });

      return { ok: true, sweptSessions };
    }),

  release: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        userId: z.string().min(1),
      }),
    )
    .permission("organization:manage")
    .mutation(async ({ ctx, input }) =>
      releaseHeldAccount({
        organizationId: input.organizationId,
        userId: input.userId,
        actorUserId: ctx.session.user.id,
        membership: signInSecurityMembership(),
        lockout: signInLockout(),
        evidence: signInSecurityReleaseEvidence(),
      }),
    ),
});
