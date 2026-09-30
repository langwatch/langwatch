import { setTimeout as delay } from "node:timers/promises";
import { auditLog } from "@ee/audit-log/auditLog";
import { ssoIdpRegistrationSchema } from "@ee/sso/sso-idp-registration";
import {
  ssoArrivalPolicySchema,
  ssoMigrationRouteSchema,
} from "@langwatch/identity";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  assertEnterprisePlan,
  ENTERPRISE_FEATURE_ERRORS,
  EnterprisePlanRequiredError,
} from "~/server/api/enterprise";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import {
  ssoBreakGlass,
  ssoConnectionHistory,
  ssoSelfServe,
} from "~/server/app-layer/identity/runtime";

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

/** How often `onHistoryActivity` re-reads the history to see whether the
 *  newest event id moved. An administrator watching this page is not
 *  watching a hot trace stream — a few seconds of latency on "a domain was
 *  just verified" costs nothing a page reload wouldn't have cost anyway. */
const HISTORY_ACTIVITY_POLL_MS = 4_000;

/**
 * Pure decision: has the connection's newest event changed since the
 * previous poll? Factored out so the tick logic is testable without driving
 * a live async generator against real timers.
 */
export function historyActivityChanged({
  current,
  previous,
}: {
  current: string | null;
  previous: string | null;
}): boolean {
  return current !== previous;
}

/**
 * Sleep for `ms`, or return early — never rejecting — when `signal` fires
 * first. The subscription's own `while (!signal?.aborted)` guard is what
 * actually ends the loop; this only keeps an aborted wait from surfacing as
 * an unhandled rejection.
 */
async function sleepUnlessAborted({
  ms,
  signal,
}: {
  ms: number;
  signal?: AbortSignal;
}): Promise<void> {
  try {
    await delay(ms, undefined, { signal });
  } catch {
    // Aborted mid-sleep: the loop condition re-checks and exits.
  }
}

/** The one call `onHistoryActivity` polls — narrowed to exactly what it
 *  needs, so a test can hand in a fake without composing the whole
 *  history service. */
export interface HistoryActivityReadsPort {
  getHistory(input: {
    organizationId: string;
    connectionId: string;
    limit: number;
  }): Promise<readonly { eventId: string }[]>;
}

/**
 * The subscription's own tick loop, pulled out of the procedure so it is
 * testable without driving a live async generator against real timers: a
 * test hands in `pollMs: 0` and a fake reads port, then aborts the signal
 * after however many ticks it wants to observe.
 *
 * ONLY EVER READS THE TENANT IT WAS GIVEN. There is no widening here — every
 * tick calls `reads.getHistory` with the exact `organizationId` and
 * `connectionId` this generator was constructed with, which is the same
 * structural guarantee `EventLogSsoConnectionHistoryRepository` itself
 * holds one layer down.
 */
export async function* ssoHistoryActivityTicks({
  organizationId,
  connectionId,
  reads,
  signal,
  pollMs = HISTORY_ACTIVITY_POLL_MS,
}: {
  organizationId: string;
  connectionId: string;
  reads: HistoryActivityReadsPort;
  signal?: AbortSignal;
  pollMs?: number;
}): AsyncGenerator<{ connectionId: string }> {
  let previousEventId: string | null = null;
  let observedFirstTick = false;

  while (!signal?.aborted) {
    try {
      const [latest] = await reads.getHistory({
        organizationId,
        connectionId,
        limit: 1,
      });
      const currentEventId = latest?.eventId ?? null;
      if (
        observedFirstTick &&
        historyActivityChanged({
          current: currentEventId,
          previous: previousEventId,
        })
      ) {
        yield { connectionId };
      }
      previousEventId = currentEventId;
      observedFirstTick = true;
    } catch {
      // A transient read failure is not a signal that something changed;
      // the next tick tries again rather than tearing the subscription
      // down.
    }
    await sleepUnlessAborted({ ms: pollMs, signal });
  }
}

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
  ctx: {
    session: { user: { id: string; impersonator?: { id: string } | null } };
  };
  action: string;
  args: Record<string, unknown>;
}): Promise<{ userId: string }> {
  const userId = ctx.session.user.id;
  await auditLog({
    userId,
    // Under an impersonation `user.id` is the customer whose access is being
    // borrowed, so without this the operator's act is filed against them.
    actorUserId: ctx.session.user.impersonator?.id ?? null,
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
    await requireEnterpriseSso({ organizationId: input.organizationId });
    return next();
  });

/**
 * The plan refusal, as a named failure rather than a sentence.
 *
 * The cause is knowable and the customer can act on it, so the refusal
 * carries the code the client registry keys its copy off
 * (`enterprise_plan_required`) and the 402 that says "buy the plan" rather
 * than "fix the request" (ADR-045). A bare `FORBIDDEN` carrying prose can only
 * render under the generic unknown title.
 *
 * Only the plan's own refusal is translated. Anything else the plan read
 * throws is a platform failure and keeps its own way out: dressing an
 * infrastructure error up as a handled one promises the caller an action they
 * do not have.
 */
async function requireEnterpriseSso({
  organizationId,
}: {
  organizationId: string;
}): Promise<void> {
  try {
    await assertEnterprisePlan({
      organizationId,
      errorMessage: ENTERPRISE_FEATURE_ERRORS.SSO,
    });
  } catch (error) {
    if (error instanceof TRPCError && error.code === "FORBIDDEN") {
      throw new EnterprisePlanRequiredError("SSO");
    }
    throw error;
  }
}

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

  getMigrationProgress: protectedProcedure
    .input(
      connectionInput.extend({
        cursor: z.string().min(1).nullable().default(null),
        limit: z.number().int().min(1).max(100).default(25),
      }),
    )
    .permission("sso:view")
    .query(({ input }) => ssoSelfServe().getMigrationProgress(input)),

  /**
   * The connection's raw event history (ADR-117 SS5, D04): what happened,
   * newest first — registered, domain claimed, verified or attested,
   * activated, suspended, and so on.
   *
   * `sso:manage`, deliberately narrower than the rest of this router's
   * reads. The overview and the setup journey answer "where does the
   * connection stand"; the history is close to an audit trail of every
   * actor who has touched it — including a claim's rejection note and an
   * attestation's — and that is a stronger disclosure than state alone, so
   * it is offered only to whoever could act on the connection, not to
   * every reader who may merely see it.
   */
  getHistory: protectedProcedure
    .input(connectionInput)
    .permission("sso:manage")
    .query(({ input }) =>
      ssoConnectionHistory().getHistory({
        organizationId: input.organizationId,
        connectionId: input.connectionId,
      }),
    ),

  /**
   * "Something changed in this connection's history" — a bare signal
   * `HistorySection` subscribes to so the identity provider page updates
   * itself without a manual refresh (specs/identity/
   * sso-connection-history.feature, "Live updates").
   *
   * SCOPED TO THIS PAGE, NOT A NEW TRANSPORT. This is one more procedure on
   * this router, served by the existing generic tRPC-over-SSE bridge
   * (`server/routes/sse.ts`) every other subscription in the product already
   * uses. The browser opens it only from inside `HistorySection` while the
   * identity provider page is mounted — there is no root layout, app shell
   * or provider that opens one anywhere else, so leaving the page closes it
   * the ordinary way an unmounted subscription always closes.
   *
   * NO NEW WRITE PATH. The handler is a bounded poll: on an interval, it
   * calls the exact same `ssoConnectionHistory().getHistory` this router's
   * own `getHistory` query calls, and yields only when the newest event id
   * differs from the previous tick. Nothing is appended to any pipeline and
   * no broadcaster is touched — the poll IS the read endpoint, called on a
   * timer instead of on a page load.
   *
   * `sso:manage`, matching `getHistory` exactly: this signal exists to
   * refresh that one query, so it needs that query's own permission and no
   * other.
   */
  onHistoryActivity: protectedProcedure
    .input(connectionInput)
    .permission("sso:manage")
    .subscription(({ input, signal }) =>
      ssoHistoryActivityTicks({
        organizationId: input.organizationId,
        connectionId: input.connectionId,
        reads: ssoConnectionHistory(),
        signal,
      }),
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
          protocol: input.idp.protocol,
        },
      });
      return ssoSelfServe().registerConnection({
        organizationId: input.organizationId,
        providerId: input.providerId,
        idp: input.idp,
        actor,
      });
    }),

  /**
   * Register a direct connection beside this organization's grandfathered
   * provider. Credentials are intentionally omitted from the audit row just
   * as they are for an ordinary registration.
   */
  startLegacyMigration: enterpriseSsoProcedure
    .input(
      orgInput.extend({
        legacyConnectionId: z.string().min(1),
        providerId: z.string().min(1).max(100),
        idp: ssoIdpRegistrationSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const actor = await audited({
        ctx,
        action: "startLegacyMigration",
        args: {
          organizationId: input.organizationId,
          connectionId: input.legacyConnectionId,
          providerId: input.providerId,
          protocol: input.idp.protocol,
        },
      });
      return ssoSelfServe().startLegacyMigration({ ...input, actor });
    }),

  /**
   * Route selection is one recovery lever with two directions. Moving normal
   * traffic to the replacement is part of the paid rollout; moving it back
   * to the grandfathered provider is always reachable, including after a
   * subscription lapses.
   */
  selectMigrationRoute: protectedProcedure
    .input(connectionInput.extend({ route: ssoMigrationRouteSchema }))
    .permission("sso:manage")
    .mutation(async ({ ctx, input }) => {
      if (input.route === "direct") {
        await requireEnterpriseSso({ organizationId: input.organizationId });
      }
      const actor = await audited({
        ctx,
        action: "selectMigrationRoute",
        args: input,
      });
      return ssoSelfServe().selectMigrationRoute({ ...input, actor });
    }),

  finalizeLegacyMigration: enterpriseSsoProcedure
    .input(connectionInput)
    .mutation(async ({ ctx, input }) => {
      const actor = await audited({
        ctx,
        action: "finalizeLegacyMigration",
        args: input,
      });
      return ssoSelfServe().finalizeLegacyMigration({ ...input, actor });
    }),

  claimDomain: protectedProcedure
    .input(domainInput)
    .permission("sso:manage")
    .mutation(async ({ ctx, input }) => {
      const actor = await audited({ ctx, action: "claimDomain", args: input });
      return ssoSelfServe().claimDomain({ ...input, actor });
    }),

  /** Begins DNS or HTTPS proof and returns the one-time evidence to publish. */
  proveDomain: protectedProcedure
    .input(domainInput)
    .permission("sso:manage")
    .mutation(async ({ ctx, input }) => {
      const actor = await audited({ ctx, action: "proveDomain", args: input });
      return ssoSelfServe().proveDomain({ ...input, actor });
    }),

  /**
   * Take a domain back out of the connection. Refused for a verified domain
   * on a live connection — the connection itself is what leaves then.
   */
  removeDomain: protectedProcedure
    .input(domainInput)
    .permission("sso:manage")
    .mutation(async ({ ctx, input }) => {
      const actor = await audited({ ctx, action: "removeDomain", args: input });
      return ssoSelfServe().removeDomain({ ...input, actor });
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
   * Who this connection admits (ADR-117 §3).
   *
   * The whole input is audited, policy included: which of the three answers
   * an organization is on is the fact somebody asking "why did a stranger
   * turn up in our member list at 03:14" needs, and there is nothing in it
   * they must not see.
   */
  setArrivals: enterpriseSsoProcedure
    .input(connectionInput.extend({ policy: ssoArrivalPolicySchema }))
    .mutation(async ({ ctx, input }) => {
      const actor = await audited({ ctx, action: "setArrivals", args: input });
      return ssoSelfServe().setArrivals({
        organizationId: input.organizationId,
        connectionId: input.connectionId,
        policy: input.policy,
        actor,
      });
    }),

  /**
   * The word on the card.
   *
   * `sso:manage` but NOT the enterprise assertion the changes around it
   * carry: a rename decides nothing about who signs in, and an organization
   * whose plan lapsed still reads these cards. Refusing it would leave them
   * looking at a name they cannot correct, which protects nobody.
   *
   * The name is audited in full — it is the word the card will show, and
   * "who changed what this is called, and when" is exactly what the history
   * beside it is for.
   */
  rename: protectedProcedure
    .input(connectionInput.extend({ name: z.string().trim().min(1).max(120) }))
    .permission("sso:manage")
    .mutation(async ({ ctx, input }) => {
      const actor = await audited({ ctx, action: "rename", args: input });
      return ssoSelfServe().rename({
        organizationId: input.organizationId,
        connectionId: input.connectionId,
        name: input.name,
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
