/**
 * @vitest-environment node
 *
 * The identity provider page's live-update signal: a bare "something
 * changed" the client polls for and refetches on — scoped to this one
 * router, gated exactly like the read it refreshes, and never a global
 * channel.
 *
 * Corresponds to specs/identity/sso-connection-history.feature — the "Live
 * updates" scenarios, and the permission the read and the signal share.
 */
import { authzDeclarationOf } from "@langwatch/authz";
import { describe, expect, it, vi } from "vitest";

/**
 * `ssoSetup.ts`'s import graph reaches `~/server/app-layer/identity/runtime`,
 * which reaches `better-auth/index.ts` and `auth.ts` at module load — the
 * same reason `ssoSetup.plan.unit.test.ts` mocks the runtime whole rather
 * than importing the real composition root. This suite never calls a
 * procedure handler through a caller (it inspects the router's own
 * declarations and drives the exported generator directly), so the mock
 * only needs to let the module finish evaluating.
 */
const stubBetterAuthAdapter = vi.hoisted(() => ({
  id: "stub",
  create: async () => ({}),
  update: async () => ({}),
  updateMany: async () => 0,
  findOne: async () => null,
  findMany: async () => [],
  delete: async () => undefined,
  deleteMany: async () => 0,
  count: async () => 0,
}));

vi.mock("~/server/app-layer/identity/runtime", () => ({
  // Read at module load by the better-auth request hooks on this router's
  // import graph (GAC-09). Locks nobody: these suites assert nothing about
  // lock-out, and a mock that omits the export fails the whole file at
  // collection rather than at an assertion.
  signInLockout: () => ({
    refuseIfLockedOut: async () => void 0,
    recordFailure: async () => void 0,
    recordSuccess: async () => void 0,
  }),
  deploymentOffersPasskeys: () => false,
  addressRoutesToConnection: async () => false,
  clearSignUpConfirmationPending: async () => void 0,
  ssoSelfServe: () => ({ getSetup: vi.fn(), getMigrationProgress: vi.fn() }),
  ssoBreakGlass: () => ({}),
  ssoConnectionHistory: () => ({ getHistory: vi.fn() }),
  BACKUP_CODE_COUNT: 10,
  identityBridgeCeremonies: () => ({}),
  identityCeremonies: () => ({}),
  identityStorageAdapter: () => () => stubBetterAuthAdapter,
  organizationMfa: () => ({
    standingForSession: async () => ({ satisfaction: { satisfied: true } }),
  }),
  deploymentOffersTwoStepVerification: () => false,
  secondaryStorage: () => ({ configured: false, connection: () => null }),
  betterAuthInstance: () => ({ provide: () => undefined }),
  PASSWORD_HASH_ROUNDS: 10,
  passkeySignUp: () => ({}),
  ssoAssertion: () => ({}),
  ssoProvisionedUsers: () => ({}),
  databaseHooks: () => ({}),
  credentialSessions: () => ({}),
  sessionClaims: () => ({}),
  sessionCallbackEvidence: () => ({}),
  deploymentIsFederationCapable: () => false,
  resolveSignInMethodPolicy: async () => ({}),
  mfaCeremonies: () => ({}),
}));

vi.mock("~/server/db", () => ({ prisma: {} }));

vi.mock("@ee/audit-log/auditLog", () => ({ auditLog: vi.fn() }));

import {
  type HistoryActivityReadsPort,
  historyActivityChanged,
  ssoHistoryActivityTicks,
  ssoSetupRouter,
} from "./ssoSetup";

const ACME = "org_acme";
const CONNECTION = "ssoc_acme";

describe("historyActivityChanged", () => {
  /** @scenario "A poll that finds nothing new says nothing" */
  it("says nothing changed when the newest event id is the same as last time", () => {
    expect(
      historyActivityChanged({ current: "evt_1", previous: "evt_1" }),
    ).toBe(false);
    expect(historyActivityChanged({ current: null, previous: null })).toBe(
      false,
    );
  });

  /** @scenario "A new fact wakes the signal, and only for its own organization" */
  it("says something changed when the newest event id moved", () => {
    expect(
      historyActivityChanged({ current: "evt_2", previous: "evt_1" }),
    ).toBe(true);
  });
});

describe("given the activity subscription's own poll loop", () => {
  /** A fixed sequence of "what the newest event looks like" per tick,
   *  clamped to the last entry once exhausted (steady state). */
  function readsOver(sequence: readonly { eventId: string }[][]) {
    const calls: { organizationId: string; connectionId: string }[] = [];
    let tick = 0;
    const reads: HistoryActivityReadsPort = {
      getHistory: vi.fn(async ({ organizationId, connectionId }) => {
        calls.push({ organizationId, connectionId });
        const entries = sequence[Math.min(tick, sequence.length - 1)] ?? [];
        tick += 1;
        return entries;
      }),
    };
    return { reads, calls };
  }

  /** @scenario "A poll that finds nothing new says nothing" */
  it("yields nothing while every tick sees the same newest event", async () => {
    const { reads, calls } = readsOver([[{ eventId: "evt_1" }]]);
    const controller = new AbortController();
    // Real, tiny timers: a few ticks at 5ms apiece, then stop the loop from
    // outside — nothing here has any reason to change, so the generator
    // would otherwise poll forever.
    setTimeout(() => controller.abort(), 30);

    const seen: unknown[] = [];
    for await (const value of ssoHistoryActivityTicks({
      organizationId: ACME,
      connectionId: CONNECTION,
      reads,
      signal: controller.signal,
      pollMs: 5,
    })) {
      seen.push(value);
    }

    expect(seen).toEqual([]);
    // It actually polled more than once — this is a live loop, not a
    // single read dressed up as a subscription.
    expect(calls.length).toBeGreaterThan(1);
  });

  /** @scenario "A new fact wakes the signal, and only for its own organization" */
  it("yields once the newest event id moves, naming the connection it watches", async () => {
    const { reads, calls } = readsOver([
      [{ eventId: "evt_1" }],
      [{ eventId: "evt_2" }],
    ]);
    const controller = new AbortController();

    const seen: unknown[] = [];
    for await (const value of ssoHistoryActivityTicks({
      organizationId: ACME,
      connectionId: CONNECTION,
      reads,
      signal: controller.signal,
      pollMs: 5,
    })) {
      seen.push(value);
      // Stop as soon as the signal this test cares about arrives — `break`
      // on a `for await` returns the generator, tearing the loop down the
      // same way an unmounted subscription does.
      controller.abort();
      break;
    }

    // The FIRST tick only establishes a baseline — there is nothing to
    // compare it against yet — so exactly one signal comes out, not two.
    expect(seen).toEqual([{ connectionId: CONNECTION }]);
    // Every tick read this subscription's own organization and connection,
    // never anything wider.
    for (const call of calls) {
      expect(call).toEqual({ organizationId: ACME, connectionId: CONNECTION });
    }
  });
});

describe("given the router declaration itself", () => {
  const procedures = (
    ssoSetupRouter as unknown as {
      _def: {
        procedures: Record<string, { _def?: { middlewares?: unknown[] } }>;
      };
    }
  )._def.procedures;

  const declarationFor = (path: string) =>
    (procedures[path]?._def?.middlewares ?? [])
      .map((middleware) => authzDeclarationOf(middleware))
      .find((found) => found !== null) ?? null;

  /** @scenario "The live subscription is gated exactly like the read it refreshes" */
  it("requires the same permission as getHistory, not a weaker one", () => {
    const historyDeclaration = declarationFor("getHistory");
    const activityDeclaration = declarationFor("onHistoryActivity");

    expect(historyDeclaration).toMatchObject({
      kind: "permission",
      permission: "sso:manage",
    });
    expect(activityDeclaration).toEqual(historyDeclaration);
  });

  /** @scenario "Seeing the history takes managing single sign-on, not only seeing it" */
  it("holds the history to sso:manage while the overview and the setup journey stay at sso:view", () => {
    // THE HISTORY IS A STRONGER DISCLOSURE THAN THE STATE. It is close to an
    // audit trail of every actor who has touched the connection — a claim's
    // rejection note, an attestation's — so somebody who may only SEE single
    // sign-on is refused it.
    expect(declarationFor("getHistory")).toMatchObject({
      kind: "permission",
      permission: "sso:manage",
    });

    // And that same reader is refused nothing else on this surface: the two
    // reads that answer "where does the connection stand" are still theirs.
    // Asserted together, because the scenario is the CONTRAST — a change that
    // lifted every read to `sso:manage` would satisfy the assertion above on
    // its own while quietly closing the page to security reviewers.
    for (const read of ["getSetup", "getMigrationProgress"]) {
      expect(declarationFor(read)).toMatchObject({
        kind: "permission",
        permission: "sso:view",
      });
    }
  });
});
