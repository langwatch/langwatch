import { describe, expect, it } from "vitest";
import { createTenantId } from "../../..";
import type { Command } from "../../../commands/command";
import {
  AttachIdentifierCommand,
  DetachIdentifierCommand,
  EraseUserCommand,
  IdentityCommandRefusedError,
  type IdentityGuardReads,
  MarkPrimaryCommand,
  VerifyIdentifierCommand,
} from "../commands/identityCommands";
import {
  type IdentityFoldState,
  IdentityStateFoldProjection,
} from "../projections/identityState.foldProjection";
import type {
  IdentifierFact,
  IdentityLedgerState,
} from "../projections/reduceIdentity";
import {
  IDENTIFIER_ATTACHED_EVENT_TYPE,
  IDENTIFIER_DEAD_ENDED_EVENT_TYPE,
  IDENTIFIER_VERIFIED_EVENT_TYPE,
} from "../schemas/constants";
import type { IdentityEvent } from "../schemas/events";

const USER = "user_sam";
const ACTOR = { type: "user" as const, id: USER };
const T0 = 1_690_000_000_000;

class InMemoryGuardReads implements IdentityGuardReads {
  hashKeys = new Map<string, string>();
  states = new Map<string, IdentityLedgerState>();
  activeByValue = new Map<string, { userId: string; identifierId: string }>();

  async getUserHashKey({ userId }: { userId: string }) {
    return this.hashKeys.get(userId) ?? null;
  }

  async findActiveIdentifierByValue({
    normalizedValue,
  }: {
    normalizedValue: string;
  }) {
    return this.activeByValue.get(normalizedValue) ?? null;
  }

  async loadIdentityState({ userId }: { userId: string }) {
    return this.states.get(userId) ?? { userId, identifiers: {} };
  }
}

function command<T>(data: T): Command<T> {
  return {
    tenantId: createTenantId(USER),
    aggregateId: USER,
    type: "lw.identity.test",
    data,
  } as unknown as Command<T>;
}

function attachData(overrides?: Record<string, unknown>) {
  return {
    tenantId: USER,
    userId: USER,
    commandId: "idcmd_1",
    accountId: "acc_1",
    provider: "google" as const,
    providerAccountId: "gid_123",
    value: "Sam.J+x@Acme.com",
    occurredAtMs: T0,
    ceremony: { flow: "oauth-callback" },
    actor: ACTOR,
    ...overrides,
  };
}

function fact(overrides?: Partial<IdentifierFact>): IdentifierFact {
  return {
    identifierId: "idf_work",
    userId: USER,
    provider: "email",
    value: "sam@acme.com",
    domain: "acme.com",
    identifierHash: "hmac:abc",
    accountId: null,
    connectionId: null,
    state: "VERIFIED",
    verifiedAtMs: T0,
    attachedAtMs: T0,
    detachedAtMs: null,
    ...overrides,
  };
}

function stateWith(...facts: IdentifierFact[]): IdentityLedgerState {
  return {
    userId: USER,
    identifiers: Object.fromEntries(facts.map((f) => [f.identifierId, f])),
  };
}

function foldAll(events: IdentityEvent[]): IdentityFoldState {
  const projection = new IdentityStateFoldProjection({
    store: {
      load: async () => null,
      store: async () => void 0,
    },
  });
  return events.reduce(
    (state, event) => projection.apply(state, event),
    projection.init(),
  );
}

describe("attachIdentifier command", () => {
  describe("when a ceremony attaches an OAuth identifier", () => {
    /** @scenario "Attaching an identifier records the fact and the projection row" */
    it("emits the normalized email, domain, and HMAC hash, and folds to a VERIFIED row", async () => {
      const reads = new InMemoryGuardReads();
      reads.hashKeys.set(USER, "key_material");
      const events = await new AttachIdentifierCommand(reads).handle(
        command(attachData()),
      );
      expect(events).toHaveLength(1);
      const event = events[0]!;
      expect(event.type).toBe(IDENTIFIER_ATTACHED_EVENT_TYPE);
      expect(event.aggregateId).toBe(USER);
      expect(event.data.email).toBe("sam.j@acme.com");
      expect(event.data.domain).toBe("acme.com");
      expect(event.data.identifierHash).toMatch(/^hmac:[0-9a-f]{64}$/);
      expect(event.data.state).toBe("VERIFIED");
      // The payload rule (ADR-101 §4): the payload's whole shape — nothing
      // secret-shaped exists to leak.
      expect(Object.keys(event.data).sort()).toEqual([
        "accountId",
        "actor",
        "connectionId",
        "domain",
        "email",
        "identifierHash",
        "identifierId",
        "provider",
        "state",
        "userId",
      ]);

      const folded = foldAll(events);
      const row = folded.identifiers[event.data.identifierId]!;
      expect(row.state).toBe("VERIFIED");
      expect(row.verifiedAtMs).toBe(T0);
    });

    it("records a null hash when the user's hash key is not yet minted", async () => {
      const events = await new AttachIdentifierCommand(
        new InMemoryGuardReads(),
      ).handle(command(attachData()));
      expect(events[0]!.data.identifierHash).toBeNull();
    });

    it("attaches email-provider identifiers ATTACHED, awaiting the ceremony", async () => {
      const events = await new AttachIdentifierCommand(
        new InMemoryGuardReads(),
      ).handle(
        command(
          attachData({
            provider: "email",
            providerAccountId: null,
            accountId: null,
          }),
        ),
      );
      expect(events[0]!.data.state).toBe("ATTACHED");
    });
  });

  describe("when the same fact is emitted twice", () => {
    /** @scenario "Identifier ids are deterministic so backfill and live emission converge" */
    it("derives the same identifier id and folds to exactly one row", async () => {
      const reads = new InMemoryGuardReads();
      const first = await new AttachIdentifierCommand(reads).handle(
        command(attachData()),
      );
      const second = await new AttachIdentifierCommand(reads).handle(
        command(attachData({ commandId: "idcmd_2" })),
      );
      expect(first[0]!.data.identifierId).toBe(second[0]!.data.identifierId);
      const folded = foldAll([...first, ...second]);
      expect(Object.keys(folded.identifiers)).toHaveLength(1);
    });

    /** @scenario "A retried command dedupes at the event store" */
    it("keys idempotency as commandId:index so a retry dedupes", async () => {
      const reads = new InMemoryGuardReads();
      const first = await new AttachIdentifierCommand(reads).handle(
        command(attachData()),
      );
      const retry = await new AttachIdentifierCommand(reads).handle(
        command(attachData()),
      );
      expect(first[0]!.idempotencyKey).toBe("idcmd_1:0");
      expect(retry[0]!.idempotencyKey).toBe("idcmd_1:0");
    });
  });
});

describe("verifyIdentifier command", () => {
  describe("when another user already holds the verified value", () => {
    /** @scenario "Concurrent verification races dead-end the loser" */
    it("dead-ends the identifier instead of verifying it", async () => {
      const reads = new InMemoryGuardReads();
      reads.states.set(
        USER,
        stateWith(fact({ state: "ATTACHED", verifiedAtMs: null })),
      );
      reads.activeByValue.set("sam@acme.com", {
        userId: "user_other",
        identifierId: "idf_theirs",
      });
      const events = await new VerifyIdentifierCommand(reads).handle(
        command({
          tenantId: USER,
          userId: USER,
          commandId: "idcmd_v1",
          identifierId: "idf_work",
          verificationId: "verif_1",
          method: "magic-link" as const,
          occurredAtMs: T0 + 1000,
          actor: ACTOR,
        }),
      );
      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe(IDENTIFIER_DEAD_ENDED_EVENT_TYPE);
      expect(events[0]!.data).toMatchObject({
        identifierId: "idf_work",
        reason: "uniqueness_race_lost",
      });
    });
  });

  describe("when the value is unheld", () => {
    it("verifies the ATTACHED identifier with the ceremony's proof trail", async () => {
      const reads = new InMemoryGuardReads();
      reads.states.set(
        USER,
        stateWith(fact({ state: "ATTACHED", verifiedAtMs: null })),
      );
      const events = await new VerifyIdentifierCommand(reads).handle(
        command({
          tenantId: USER,
          userId: USER,
          commandId: "idcmd_v1",
          identifierId: "idf_work",
          verificationId: "verif_1",
          method: "magic-link" as const,
          occurredAtMs: T0 + 1000,
          actor: ACTOR,
        }),
      );
      expect(events[0]!.type).toBe(IDENTIFIER_VERIFIED_EVENT_TYPE);
      expect(events[0]!.data).toMatchObject({
        identifierId: "idf_work",
        verificationId: "verif_1",
        method: "magic-link",
      });
    });

    it("refuses to verify an identifier the user does not hold", async () => {
      const reads = new InMemoryGuardReads();
      await expect(
        new VerifyIdentifierCommand(reads).handle(
          command({
            tenantId: USER,
            userId: USER,
            commandId: "idcmd_v1",
            identifierId: "idf_missing",
            verificationId: null,
            method: "magic-link" as const,
            occurredAtMs: T0,
            actor: ACTOR,
          }),
        ),
      ).rejects.toMatchObject({ code: "identity_identifier_not_found" });
    });
  });
});

describe("markPrimary command", () => {
  describe("when another identifier holds PRIMARY", () => {
    /** @scenario "Exactly one PRIMARY identifier per user" */
    it("promotes the VERIFIED identifier and demotes the previous PRIMARY", async () => {
      const reads = new InMemoryGuardReads();
      reads.states.set(
        USER,
        stateWith(
          fact({ identifierId: "idf_work", state: "VERIFIED" }),
          fact({
            identifierId: "idf_personal",
            state: "PRIMARY",
            value: "sam@personal.dev",
          }),
        ),
      );
      const events = await new MarkPrimaryCommand(reads).handle(
        command({
          tenantId: USER,
          userId: USER,
          commandId: "idcmd_p1",
          identifierId: "idf_work",
          occurredAtMs: T0 + 2000,
          actor: ACTOR,
        }),
      );
      expect(events[0]!.data).toMatchObject({
        identifierId: "idf_work",
        previousIdentifierId: "idf_personal",
      });
    });
  });
});

describe("detachIdentifier command", () => {
  describe("when the target is PRIMARY", () => {
    /** @scenario "A PRIMARY identifier never detaches directly" */
    it("refuses with identity_primary_must_demote_first and emits nothing", async () => {
      const reads = new InMemoryGuardReads();
      reads.states.set(
        USER,
        stateWith(fact({ identifierId: "idf_personal", state: "PRIMARY" })),
      );
      const handler = new DetachIdentifierCommand(reads);
      const attempt = handler.handle(
        command({
          tenantId: USER,
          userId: USER,
          commandId: "idcmd_d1",
          identifierId: "idf_personal",
          occurredAtMs: T0,
          actor: ACTOR,
        }),
      );
      await expect(attempt).rejects.toBeInstanceOf(IdentityCommandRefusedError);
      await expect(
        handler
          .handle(
            command({
              tenantId: USER,
              userId: USER,
              commandId: "idcmd_d1",
              identifierId: "idf_personal",
              occurredAtMs: T0,
              actor: ACTOR,
            }),
          )
          .catch((error: IdentityCommandRefusedError) => error.code),
      ).resolves.toBe("identity_primary_must_demote_first");
    });
  });

  describe("when the target is VERIFIED", () => {
    /** @scenario "A detached identifier is a tombstone, forever resolvable" */
    it("detaches to a tombstone row carrying its detachedAt", async () => {
      const reads = new InMemoryGuardReads();
      reads.hashKeys.set(USER, "key_material");
      const attached = await new AttachIdentifierCommand(reads).handle(
        command(attachData()),
      );
      const identifierId = attached[0]!.data.identifierId;
      reads.states.set(USER, foldAll(attached));
      const detached = await new DetachIdentifierCommand(reads).handle(
        command({
          tenantId: USER,
          userId: USER,
          commandId: "idcmd_d1",
          identifierId,
          occurredAtMs: T0 + 5000,
          actor: ACTOR,
        }),
      );
      const folded = foldAll([...attached, ...detached]);
      const row = folded.identifiers[identifierId]!;
      expect(row.state).toBe("DETACHED");
      expect(row.detachedAtMs).toBe(T0 + 5000);
      expect(row.value).toBe("sam.j@acme.com");
    });
  });
});

describe("eraseUser command", () => {
  describe("when a user with identifiers is erased", () => {
    /** @scenario "Erasure wipes values and leaves a replayable tombstone" */
    it("names every identifier, and folding wipes values and hashes while rows remain", async () => {
      const reads = new InMemoryGuardReads();
      reads.hashKeys.set(USER, "key_material");
      const attachedA = await new AttachIdentifierCommand(reads).handle(
        command(attachData()),
      );
      const attachedB = await new AttachIdentifierCommand(reads).handle(
        command(
          attachData({
            commandId: "idcmd_b",
            provider: "email",
            providerAccountId: null,
            accountId: null,
            value: "sam@personal.dev",
          }),
        ),
      );
      reads.states.set(USER, foldAll([...attachedA, ...attachedB]));
      const erased = await new EraseUserCommand(reads).handle(
        command({
          tenantId: USER,
          userId: USER,
          commandId: "idcmd_e1",
          occurredAtMs: T0 + 9000,
          actor: { type: "system" as const, id: "ops:erasure-request" },
        }),
      );
      expect(erased[0]!.data.erasedIdentifierIds.sort()).toEqual(
        [
          attachedA[0]!.data.identifierId,
          attachedB[0]!.data.identifierId,
        ].sort(),
      );

      const folded = foldAll([...attachedA, ...attachedB, ...erased]);
      const rows = Object.values(folded.identifiers);
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row.value).toBeNull();
        expect(row.identifierHash).toBeNull();
        expect(row.domain).not.toBeNull();
      }
    });
  });
});
