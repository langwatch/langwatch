/**
 * The in-memory event store's own contract.
 *
 * Every suite here that drives a ceremony runs on this double, and what it
 * has to reproduce is the ONE property of the real store those suites depend
 * on: a fact is keyed `<commandId>:<index>`, and a key already taken absorbs
 * the append rather than writing a second row. Without it a retried ceremony
 * appears to duplicate — which it does not, in production — and suites start
 * failing on the wall clock instead of on behaviour.
 *
 * Pinned directly, because a double whose fidelity is only ever exercised
 * indirectly is a double that quietly loses it.
 */
import {
  IDENTIFIER_ATTACHED_EVENT_TYPE,
  IDENTIFIER_VERIFIED_EVENT_TYPE,
  type IdentityFactInput,
} from "@langwatch/identity";
import { describe, expect, it } from "vitest";
import { InMemoryIdentityEventStore } from "./support/in-memory-event-store";
import { ACTOR, USER } from "./support/in-memory-heads";

const attached = (identifierId: string): IdentityFactInput => ({
  type: IDENTIFIER_ATTACHED_EVENT_TYPE,
  data: {
    identifierId,
    userId: USER,
    accountId: null,
    provider: "email",
    providerId: null,
    providerAccountId: null,
    value: "sam@acme.com",
    identifierHash: null,
    domain: "acme.com",
    connectionId: null,
    state: "ATTACHED",
    actor: ACTOR,
  },
});

const verified = (identifierId: string): IdentityFactInput => ({
  type: IDENTIFIER_VERIFIED_EVENT_TYPE,
  data: {
    identifierId,
    verificationId: null,
    method: "creation",
    actor: ACTOR,
  },
});

describe("the in-memory identity event store", () => {
  describe("when a command's facts are appended once", () => {
    it("holds one row per fact, keyed by the command id and the fact's position", () => {
      const store = new InMemoryIdentityEventStore();

      const { stored, landed } = store.append({
        commandId: "idcmd_1",
        facts: [attached("idf_a"), verified("idf_a")],
      });

      expect(stored).toHaveLength(2);
      expect(landed).toHaveLength(2);
      expect([...store.rows.keys()]).toEqual(["idcmd_1:0", "idcmd_1:1"]);
    });
  });

  describe("when the same command appends again", () => {
    it("absorbs it: nothing lands, and the ORIGINAL rows come back", () => {
      const store = new InMemoryIdentityEventStore();
      const first = store.append({
        commandId: "idcmd_1",
        facts: [attached("idf_a")],
        occurredAt: 1_000,
      });

      // A retry restates the fact the guard decided this time round, which is
      // not necessarily byte-identical — a born-finalized retry derives a new
      // identifier id from a later `occurredAt`. The command id is what makes
      // them one fact, and the row that stands is the one that landed first.
      const second = store.append({
        commandId: "idcmd_1",
        facts: [attached("idf_b")],
        occurredAt: 2_000,
      });

      expect(second.landed).toEqual([]);
      expect(second.stored).toEqual(first.stored);
      expect(store.rows.size).toBe(1);
      expect(store.rows.get("idcmd_1:0")).toMatchObject({
        occurredAt: 1_000,
        data: { identifierId: "idf_a" },
      });
    });

    it("absorbs each position independently, so a longer retry still lands its tail", () => {
      const store = new InMemoryIdentityEventStore();
      store.append({ commandId: "idcmd_1", facts: [attached("idf_a")] });

      const { stored, landed } = store.append({
        commandId: "idcmd_1",
        facts: [attached("idf_a"), verified("idf_a")],
      });

      expect(landed).toHaveLength(1);
      expect(landed[0]?.type).toBe(IDENTIFIER_VERIFIED_EVENT_TYPE);
      expect(stored).toHaveLength(2);
      expect(store.rows.size).toBe(2);
    });
  });

  describe("when a different command states the same fact", () => {
    it("lands it: a legitimately repeated action is not a retry", () => {
      const store = new InMemoryIdentityEventStore();
      store.append({ commandId: "idcmd_1", facts: [attached("idf_a")] });

      const { landed } = store.append({
        commandId: "idcmd_2",
        facts: [attached("idf_a")],
      });

      expect(landed).toHaveLength(1);
      expect(store.rows.size).toBe(2);
    });
  });
});
