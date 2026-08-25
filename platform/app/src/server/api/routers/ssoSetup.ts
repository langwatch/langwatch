import { auditLog } from "@ee/audit-log/auditLog";
import { ssoIdpRegistrationSchema } from "@langwatch/identity-server";
import { z } from "zod";
import {
  ssoBreakGlass,
  ssoSelfServe,
} from "~/server/app-layer/identity/runtime";
import { assertEnterprisePlan, ENTERPRISE_FEATURE_ERRORS } from "../enterprise";
import { createTRPCRouter, protectedProcedure } from "../trpc";

/**
 * Self-serve single sign-on setup, in organization Settings (D05 tiers 2
 * and 3).
 *
 * The counterpart to `ssoConnections`, which is the back office's. The two
 * surfaces are deliberately separate routers with separate gating and
 * separate reads: this one is org-scoped at the data layer and gated on
 * `sso:view` / `sso:manage`, so a bug here cannot reach another
 * organization's connection; that one is cross-tenant by design and gated on
 * the staff list. What they share is the aggregate underneath, and nothing
 * else.
 *
 * Seeing and changing are two permissions because they are two jobs: a
 * security reviewer reads which domains route and who proved them; an IT
 * administrator sets the thing up. `sso:manage` implies `sso:view` through
 * the registry's hierarchy, so an administrator does not need both granted.
 *
 * Every mutation records an audit row BEFORE the command runs, for the same
 * reason the back office does: somebody asking "why did this change at
 * 03:14" needs the attempt, not only the successes.
 */

const orgInput = z.object({ organizationId: z.string().min(1) });

const connectionInput = orgInput.extend({
  connectionId: z.string().min(1),
});

const domainInput = connectionInput.extend({
  domain: z.string().min(1).max(253),
});

/**
 * Record the attempt and answer the actor. The actor is minted from the
 * session, never taken from input: the administrator this surface
 * authenticated is who the history names.
 */
async function audited({
  ctx,
  action,
  args,
}: {
  ctx: { session: { user: { id: string } } };
  action: string;
  args: Record<string, unknown>;
}): Promise<{ userId: string }> {
  const userId = ctx.session.user.id;
  await auditLog({
    userId,
    action: `ssoSetup.${action}`,
    args,
    targetKind: "ssoConnection",
    targetId:
      typeof args.connectionId === "string" ? args.connectionId : undefined,
  });
  return { userId };
}

/**
 * Changing an organization's single sign-on takes an Enterprise plan (D09),
 * on the same shape `scimToken.ts` uses for directory tokens — and for the
 * same reason: the two are one purchase, and a customer who may mint a
 * provisioning token but not register the provider it provisions for has
 * bought half a feature.
 *
 * READS are deliberately not gated. `getSetup` answers an organization on any
 * plan, because a screen that refuses to render cannot say what it is
 * refusing — and what an administrator on a smaller plan needs from this page
 * is to be told what single sign-on would take.
 */
const enterpriseSsoProcedure = protectedProcedure
  .input(orgInput)
  .permission("sso:manage")
  .use(async ({ input, next }) => {
    await assertEnterprisePlan({
      organizationId: input.organizationId,
      errorMessage: ENTERPRISE_FEATURE_ERRORS.SSO,
    });
    return next();
  });

export const ssoSetupRouter = createTRPCRouter({
  /**
   * Everything the settings surface renders, refusal included.
   *
   * A query rather than a mutation that throws, because an organization that
   * cannot set single sign-on up still has to be TOLD why — the screen has
   * to render for the words on it to be readable.
   */
  getSetup: protectedProcedure
    .input(orgInput)
    .permission("sso:view")
    .query(({ input }) =>
      ssoSelfServe().getSetup({ organizationId: input.organizationId }),
    ),

  /**
   * Register the organization's identity provider, with what it takes to
   * dial it (D09).
   *
   * Both protocols. SAML used to be refused by name because nothing could
   * terminate it, and something can now.
   *
   * The audit row records the ATTEMPT, and deliberately not this input: it
   * carries a client secret. `auditedRegistration` below is what it records
   * instead — who, which organization, which protocol — which is everything
   * somebody asking "why did this change at 03:14" needs and nothing they
   * must not see.
   */
  register: enterpriseSsoProcedure
    .input(
      orgInput.extend({
        providerId: z.string().min(1).max(100),
        allowsJit: z.boolean().default(false),
        idp: ssoIdpRegistrationSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const actor = await audited({
        ctx,
        action: "register",
        args: {
          organizationId: input.organizationId,
          providerId: input.providerId,
          allowsJit: input.allowsJit,
          protocol: input.idp.protocol,
        },
      });
      return ssoSelfServe().registerConnection({
        organizationId: input.organizationId,
        providerId: input.providerId,
        allowsJit: input.allowsJit,
        idp: input.idp,
        actor,
      });
    }),

  claimDomain: protectedProcedure
    .input(domainInput)
    .permission("sso:manage")
    .mutation(async ({ ctx, input }) => {
      const actor = await audited({ ctx, action: "claimDomain", args: input });
      return ssoSelfServe().claimDomain({ ...input, actor });
    }),

  /**
   * Ask to prove a domain. On a licensed installation the licence proves it
   * and this finishes; on the hosted service it answers the record to
   * publish, whose value is shown once and never again.
   */
  proveDomain: protectedProcedure
    .input(domainInput)
    .permission("sso:manage")
    .mutation(async ({ ctx, input }) => {
      const actor = await audited({ ctx, action: "proveDomain", args: input });
      return ssoSelfServe().proveDomain({ ...input, actor });
    }),

  checkDomainRecord: protectedProcedure
    .input(domainInput)
    .permission("sso:manage")
    .mutation(async ({ ctx, input }) => {
      const actor = await audited({
        ctx,
        action: "checkDomainRecord",
        args: input,
      });
      return ssoSelfServe().checkDomainRecord({ ...input, actor });
    }),

  /** The same ceremony's other channel: the well-known file the domain can
   *  serve instead of publishing the record. One token satisfies either. */
  checkDomainFile: protectedProcedure
    .input(domainInput)
    .permission("sso:manage")
    .mutation(async ({ ctx, input }) => {
      const actor = await audited({
        ctx,
        action: "checkDomainFile",
        args: input,
      });
      return ssoSelfServe().checkDomainFile({ ...input, actor });
    }),

  /**
   * Turn the connection on.
   *
   * Enterprise-gated like registration, because it is the same purchase.
   * What is NOT gated is break glass below — a lapsed subscription must
   * never be the reason an organization cannot reach its recovery path.
   *
   * The three preconditions are refused one at a time by the service, so
   * the screen can name the outstanding step; the aggregate's guard checks
   * all three again underneath, for every caller it will ever have.
   */
  activate: enterpriseSsoProcedure
    .input(connectionInput)
    .mutation(async ({ ctx, input }) => {
      const actor = await audited({ ctx, action: "activate", args: input });
      return ssoSelfServe().activate({
        organizationId: input.organizationId,
        connectionId: input.connectionId,
        actor,
      });
    }),

  /**
   * The ways back in this organization holds, with who holds them and their
   * dates.
   *
   * `sso:view` rather than `sso:manage`: "who can still get in without the
   * identity provider" is precisely what a security reviewer reads this
   * surface for, and answering it in user ids would answer it for nobody.
   */
  breakGlassBindings: protectedProcedure
    .input(orgInput)
    .permission("sso:view")
    .query(({ input }) =>
      ssoSelfServe().breakGlassHistory({
        organizationId: input.organizationId,
      }),
    ),

  /**
   * Who a way back in can be granted to.
   *
   * `sso:manage`, unlike the list above: this is the organization's
   * administrators with their addresses, and only somebody who can actually
   * grant one needs it.
   */
  breakGlassCandidates: protectedProcedure
    .input(orgInput)
    .permission("sso:manage")
    .query(({ input }) =>
      ssoSelfServe().breakGlassCandidates({
        organizationId: input.organizationId,
      }),
    ),

  /**
   * Grant somebody a way in that does not use the identity provider, with
   * the date it ends. Never open-ended: the expiry is what stops a
   * break-glass grant from quietly becoming a permanent second door.
   */
  grantBreakGlass: protectedProcedure
    .input(
      orgInput.extend({
        userId: z.string().min(1),
        expiresAtMs: z.number().int().positive(),
      }),
    )
    .permission("sso:manage")
    .mutation(async ({ ctx, input }) => {
      const actor = await audited({
        ctx,
        action: "grantBreakGlass",
        args: input,
      });
      return ssoBreakGlass().grant({
        organizationId: input.organizationId,
        userId: input.userId,
        grantedByUserId: actor.userId,
        expiresAtMs: input.expiresAtMs,
      });
    }),

  /** Extend one, by writing a new one that names the old. */
  renewBreakGlass: protectedProcedure
    .input(
      orgInput.extend({
        bindingId: z.string().min(1),
        expiresAtMs: z.number().int().positive(),
      }),
    )
    .permission("sso:manage")
    .mutation(async ({ ctx, input }) => {
      const actor = await audited({
        ctx,
        action: "renewBreakGlass",
        args: input,
      });
      return ssoBreakGlass().renew({
        bindingId: input.bindingId,
        organizationId: input.organizationId,
        grantedByUserId: actor.userId,
        expiresAtMs: input.expiresAtMs,
      });
    }),

  /**
   * End a grant now, on purpose. Refused while it is a live connection's
   * only way back in — the lever exists precisely for the moment the
   * identity provider fails.
   */
  revokeBreakGlass: protectedProcedure
    .input(orgInput.extend({ bindingId: z.string().min(1) }))
    .permission("sso:manage")
    .mutation(async ({ ctx, input }) => {
      await audited({ ctx, action: "revokeBreakGlass", args: input });
      return ssoBreakGlass().revoke({
        bindingId: input.bindingId,
        organizationId: input.organizationId,
      });
    }),

  /**
   * Undo a registration that never went live: the journey opens back on the
   * register step, and the history keeps what was tried.
   */
  discardConnection: protectedProcedure
    .input(connectionInput)
    .permission("sso:manage")
    .mutation(async ({ ctx, input }) => {
      const actor = await audited({
        ctx,
        action: "discardConnection",
        args: input,
      });
      await ssoSelfServe().discardConnection({ ...input, actor });
    }),

  /**
   * Remove a live connection, on teardown's own terms: scheduled, graced
   * and reversible until it completes, and refused while anybody would be
   * left with no other way in.
   */
  removeConnection: protectedProcedure
    .input(
      connectionInput.extend({
        reason: z.string().min(1).max(1000).nullable().default(null),
      }),
    )
    .permission("sso:manage")
    .mutation(async ({ ctx, input }) => {
      const actor = await audited({
        ctx,
        action: "removeConnection",
        args: input,
      });
      await ssoSelfServe().removeConnection({
        ...input,
        actor,
        graceMs: SELF_SERVE_TEARDOWN_GRACE_MS,
      });
    }),
});

/**
 * How long a removal stays reversible before the process manager completes
 * it — the same seven days the operator surface gives, because "how long do
 * I have to change my mind" must not depend on which door the removal went
 * through.
 */
const SELF_SERVE_TEARDOWN_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
