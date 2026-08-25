/**
 * @vitest-environment jsdom
 *
 * The docblock is the lane's, not this test's: `integrationLanes.ts` reads it
 * as "this file needs no datastore", which is true here — the heads are in
 * memory and the composition root is the only thing stood in for. Without it
 * the file books the whole datastore lane to run a handful of assertions about
 * a pure guard, which is what that lane exists to stop.
 */
import type {
  IdentifierFact,
  IdentityFact,
  IdentityHeads,
} from "@langwatch/identity";
import { reduceIdentity } from "@langwatch/identity";
import type { IdentityHeadsRepository } from "@langwatch/identity-server";
import { IdentityGuards, IdentityService } from "@langwatch/identity-server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readHandledError, resolveErrorCopy } from "~/features/errors";
import { AccountIdentifiersService } from "~/server/app-layer/identity/account-identifiers.service";
import { createInnerTRPCContext, errorFormatter } from "../../trpc";

/**
 * Removing a way in, through the ROUTE.
 *
 * The guard's own tests prove it refuses; this proves the refusal survives the
 * trip — the procedure calls the service, the service calls the command, the
 * command asks the guard, and what comes back out of tRPC is a payload the
 * client's registry has words for. Guard-level coverage cannot say any of
 * that, and a guard nobody reached is not a guard.
 *
 * Only the composition root is stood in for: the heads are in memory and the
 * ledger records rather than appends, so the guard, the service, the procedure
 * and the error contract are all the real ones.
 *
 * Spec: specs/identity/authentication-settings.feature
 */

const USER_ID = "user_sam";

const { serviceRef } = vi.hoisted(() => ({
  serviceRef: { current: null as unknown },
}));

vi.mock("~/server/app-layer/identity/runtime", () => ({
  accountIdentifiers: () => serviceRef.current,
  verificationCeremony: () => {
    throw new Error("not used by these scenarios");
  },
  // The composition root is reached at MODULE LOAD by better-auth's own
  // wiring, which the router's import graph pulls in. It is named here so the
  // double is complete, and it answers an inert object rather than throwing:
  // a throw would run before any test does.
  identityStorageAdapter: () => ({}),
}));

import { identityRouter } from "../identity";

function head(overrides: Partial<IdentifierFact> & { identifierId: string }) {
  return {
    userId: USER_ID,
    provider: "email",
    value: `${overrides.identifierId}@acme.test`,
    domain: "acme.test",
    identifierHash: null,
    accountId: null,
    providerAccountId: null,
    connectionId: null,
    state: "VERIFIED",
    verifiedAtMs: 1,
    attachedAtMs: 1,
    detachedAtMs: null,
    ...overrides,
  } as IdentifierFact;
}

function headsOf(...facts: IdentifierFact[]): IdentityHeads {
  return {
    userId: USER_ID,
    identifiers: Object.fromEntries(
      facts.map((fact) => [fact.identifierId, fact]),
    ),
  };
}

/**
 * The heads, in memory, folded by the REAL reducer as facts land.
 *
 * Folding matters rather than being tidiness: a removal that demotes first is
 * two commands, and the second reads the state the first wrote. A static
 * fixture would have the guard refusing a PRIMARY that had already been
 * demoted, which is the projection lying rather than the guard being wrong.
 */
function heldHeads(state: { heads: IdentityHeads }): IdentityHeadsRepository {
  return {
    findHeads: () => Promise.resolve(state.heads),
    findUserHashKey: () => Promise.resolve(null),
    findActiveIdentifierByValue: () => Promise.resolve(null),
    findIdentifier: ({ identifierId }) =>
      Promise.resolve(state.heads.identifiers[identifierId] ?? null),
    findIdentifierIdForAccount: () => Promise.resolve(null),
  };
}

/** The wire shape a browser receives, through the router's own formatter. */
function asClientSees(error: unknown): unknown {
  return errorFormatter({
    shape: { data: {} },
    error: error as { cause?: unknown; message?: string; code?: string },
  });
}

function buildCaller(heads: IdentityHeads) {
  const state = { heads };
  const repository = heldHeads(state);
  const appended: IdentityFact[] = [];
  // The guards also ask the LEGACY branch who holds an address, and take the
  // address lock (ADR-116 §6). Neither is what these scenarios are about:
  // nobody else holds anything here, and the claim always succeeds.
  const users = {
    storeUserHashKeyIfMissing: () => Promise.resolve(),
    findEmail: () => Promise.resolve(null),
    findUserIdByEmail: () => Promise.resolve(null),
  } as never;
  const reservations = {
    claim: ({
      userId,
      identifierId,
    }: {
      userId: string;
      identifierId: string;
    }) => Promise.resolve({ userId, identifierId }),
    release: () => Promise.resolve(),
    reapOrphans: () => Promise.resolve(0),
  } as never;

  const identity = new IdentityService(
    new IdentityGuards(repository, users, reservations),
    {
      commit: ({ facts }: { facts: IdentityFact[] }) => {
        const stamped = facts.map((fact) => ({ ...fact, occurredAt: 1 }));
        appended.push(...stamped);
        for (const fact of stamped) {
          state.heads = reduceIdentity({ heads: state.heads, fact });
        }
        return Promise.resolve(stamped);
      },
    } as never,
  );

  serviceRef.current = new AccountIdentifiersService(
    repository,
    identity,
    null as never,
    {
      sendConfirmation: () => Promise.resolve(),
      buildConfirmationUrl: () => "https://example.test/confirm",
      newCommandId: () => "cmd_1",
      now: () => 1,
    },
  );

  const ctx = createInnerTRPCContext({
    session: { user: { id: USER_ID }, expires: "1" },
    req: undefined,
    res: undefined,
    permissionChecked: true,
    publiclyShared: false,
  });

  return { caller: identityRouter.createCaller(ctx), appended };
}

describe("the identity route that removes a way in", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("given the only confirmed way in is one address", () => {
    describe("when a removal request reaches the route directly", () => {
      /** @scenario The detach route refuses the last way in whatever the screen drew */
      it("refuses it with the guard's code, whatever the screen happened to draw", async () => {
        const { caller, appended } = buildCaller(
          headsOf(head({ identifierId: "only" })),
        );

        const refusal = await caller
          .removeIdentifier({ identifierId: "only" })
          .then(
            () => null,
            (error: unknown) => error,
          );

        expect(refusal).not.toBeNull();
        expect(readHandledError(asClientSees(refusal))?.code).toBe(
          "identity_detach_strands_user",
        );
        // And nothing was written on the way to being refused.
        expect(appended).toHaveLength(0);
      });

      /** @scenario The detach route refuses the last way in whatever the screen drew */
      it("carries a payload the customer copy is keyed off", async () => {
        const { caller } = buildCaller(headsOf(head({ identifierId: "only" })));

        const refusal = await caller
          .removeIdentifier({ identifierId: "only" })
          .then(
            () => null,
            (error: unknown) => error,
          );

        const copy = resolveErrorCopy({
          error: asClientSees(refusal),
          fallbackTitle: "Couldn't remove that address",
        });
        // The words the settings page shows, reached from the route's own
        // answer rather than from a sentence the screen wrote.
        expect(copy.title).toMatch(/no way back into your account/i);
        expect(copy.description).toMatch(/add a verified email address first/i);
      });
    });
  });

  describe("given passkeys and one address", () => {
    describe("when the address is removed", () => {
      /** @scenario Removing is refused where only passkeys and no address would be left */
      it("is refused, because nothing left could reach the person", async () => {
        const { caller } = buildCaller(
          headsOf(
            head({ identifierId: "address" }),
            head({
              identifierId: "passkey_1",
              provider: "passkey",
              value: null,
            }),
            head({
              identifierId: "passkey_2",
              provider: "passkey",
              value: null,
            }),
          ),
        );

        const refusal = await caller
          .removeIdentifier({ identifierId: "address" })
          .then(
            () => null,
            (error: unknown) => error,
          );

        expect(readHandledError(asClientSees(refusal))?.code).toBe(
          "identity_detach_strands_user",
        );
      });
    });
  });

  describe("given two confirmed addresses", () => {
    describe("when one is removed", () => {
      /** @scenario Removing an address that is not the last way in */
      it("detaches it and leaves the other one signing the person in", async () => {
        const { caller, appended } = buildCaller(
          headsOf(
            head({ identifierId: "first" }),
            head({ identifierId: "second" }),
          ),
        );

        await caller.removeIdentifier({ identifierId: "first" });

        expect(appended.map((fact) => fact.type)).toEqual([
          "lw.identity.identifier_detached",
        ]);
      });
    });
  });

  describe("given the primary address is not the only confirmed one", () => {
    describe("when it is removed", () => {
      /** @scenario The primary address says it is demoted before it is removed */
      it("demotes another one first and detaches in the same action", async () => {
        const { caller, appended } = buildCaller(
          headsOf(
            head({ identifierId: "primary", state: "PRIMARY" }),
            head({ identifierId: "spare" }),
          ),
        );

        await caller.removeIdentifier({ identifierId: "primary" });

        // The state machine's rule, not this surface's: PRIMARY never
        // detaches directly, so the removal is two commands the person took
        // as one click.
        expect(appended.map((fact) => fact.type)).toEqual([
          "lw.identity.primary_changed",
          "lw.identity.identifier_detached",
        ]);
      });
    });
  });

  describe("given an address nobody ever confirmed", () => {
    describe("when it is removed alongside a confirmed one", () => {
      /** @scenario An address nobody could have signed in with stays removable */
      it("goes, because losing it strands nobody", async () => {
        const { caller, appended } = buildCaller(
          headsOf(
            head({ identifierId: "confirmed" }),
            head({
              identifierId: "unconfirmed",
              state: "ATTACHED",
              verifiedAtMs: null,
            }),
          ),
        );

        await caller.removeIdentifier({ identifierId: "unconfirmed" });

        expect(appended.map((fact) => fact.type)).toEqual([
          "lw.identity.identifier_detached",
        ]);
      });
    });
  });
});
