import { describe, expect, it } from "vitest";
import {
  emptyIdentityHeads,
  type IdentityFact,
  type IdentityHeads,
} from "../facts";
import { reduceIdentity } from "../reduce";

const USER = "user_sam";
const ACTOR = { type: "user" as const, id: USER };
const T0 = 1_690_000_000_000;

function attached(
  identifierId: string,
  overrides?: Partial<
    Extract<IdentityFact, { type: "lw.identity.identifier_attached" }>["data"]
  > & { occurredAt?: number },
): IdentityFact {
  const { occurredAt, ...data } = overrides ?? {};
  return {
    type: "lw.identity.identifier_attached",
    occurredAt: occurredAt ?? T0,
    data: {
      identifierId,
      userId: USER,
      accountId: null,
      provider: "email",
      providerId: null,
      issuer: null,
      providerAccountId: null,
      value: "sam@acme.com",
      identifierHash: "hmac:abc",
      domain: "acme.com",
      connectionId: null,
      state: "ATTACHED",
      actor: ACTOR,
      ...data,
    },
  };
}

function fold(facts: IdentityFact[]): IdentityHeads {
  return facts.reduce(
    (heads, fact) => reduceIdentity({ heads, fact }),
    emptyIdentityHeads({ userId: USER }),
  );
}

describe("reduceIdentity", () => {
  describe("when a whole history folds", () => {
    // Replay PARITY - the incrementally-maintained projection against a
    // from-scratch rebuild - is proven where the row shape is, in
    // app-layer/identity/__tests__/replay-parity.unit.test.ts. Folding one
    // list twice here would prove only that a pure function is pure.
    it("leaves each identifier in the state its last fact implies", () => {
      const history: IdentityFact[] = [
        attached("idf_google", { provider: "google", state: "VERIFIED" }),
        attached("idf_email", { occurredAt: T0 + 1000 }),
        {
          type: "lw.identity.identifier_verified",
          occurredAt: T0 + 2000,
          data: {
            identifierId: "idf_email",
            verificationId: "verif_1",
            method: "magic-link",
            actor: ACTOR,
          },
        },
        {
          type: "lw.identity.primary_changed",
          occurredAt: T0 + 3000,
          data: {
            identifierId: "idf_email",
            previousIdentifierId: null,
            actor: ACTOR,
          },
        },
        {
          type: "lw.identity.identifier_detached",
          occurredAt: T0 + 4000,
          data: { identifierId: "idf_google", actor: ACTOR },
        },
      ];

      const live = fold(history);

      const states = Object.values(live.identifiers).map((head) => head.state);
      expect(states.sort()).toEqual(["DETACHED", "PRIMARY"]);
      expect(live.identifiers.idf_google?.detachedAtMs).toBe(T0 + 4000);
      expect(live.identifiers.idf_email?.verifiedAtMs).toBe(T0 + 2000);
    });
  });

  describe("when an attach folds over a head that already exists", () => {
    /** @scenario "Identifier ids are deterministic so backfill and live emission converge" */
    it("never regresses a later lifecycle state", () => {
      const heads = fold([
        attached("idf_email"),
        {
          type: "lw.identity.identifier_verified",
          occurredAt: T0 + 1,
          data: {
            identifierId: "idf_email",
            verificationId: null,
            method: "creation",
            actor: ACTOR,
          },
        },
        attached("idf_email"),
      ]);
      expect(heads.identifiers.idf_email?.state).toBe("VERIFIED");
      expect(Object.keys(heads.identifiers)).toHaveLength(1);
    });
  });

  describe("when a second identifier takes PRIMARY", () => {
    /** @scenario "Exactly one PRIMARY identifier per user" */
    it("demotes every other PRIMARY, not only the one the fact names", () => {
      const heads = fold([
        attached("idf_a", { state: "VERIFIED" }),
        attached("idf_b", { state: "VERIFIED", value: "sam@b.dev" }),
        {
          type: "lw.identity.primary_changed",
          occurredAt: T0 + 1,
          data: { identifierId: "idf_a", previousIdentifierId: null, actor: ACTOR },
        },
        {
          type: "lw.identity.primary_changed",
          occurredAt: T0 + 2,
          // A partial-window replay may name the wrong previous; the fold
          // still leaves exactly one PRIMARY standing.
          data: { identifierId: "idf_b", previousIdentifierId: null, actor: ACTOR },
        },
      ]);
      const primaries = Object.values(heads.identifiers).filter(
        (head) => head.state === "PRIMARY",
      );
      expect(primaries.map((head) => head.identifierId)).toEqual(["idf_b"]);
      expect(heads.identifiers.idf_a?.state).toBe("VERIFIED");
    });
  });

  describe("when a detached identifier is verified again", () => {
    /** @scenario "A detached identifier is a tombstone, forever resolvable" */
    it("stays a tombstone: the row remains, the state does not resurrect", () => {
      const heads = fold([
        attached("idf_email"),
        {
          type: "lw.identity.identifier_detached",
          occurredAt: T0 + 1,
          data: { identifierId: "idf_email", actor: ACTOR },
        },
        {
          type: "lw.identity.identifier_verified",
          occurredAt: T0 + 2,
          data: {
            identifierId: "idf_email",
            verificationId: null,
            method: "creation",
            actor: ACTOR,
          },
        },
      ]);
      expect(heads.identifiers.idf_email?.state).toBe("DETACHED");
      expect(heads.identifiers.idf_email?.value).toBe("sam@acme.com");
    });
  });

  describe("when a user is erased", () => {
    /** @scenario "Erasure wipes values and leaves a replayable tombstone" */
    it("wipes every value and hash, keeps every row and every domain", () => {
      const heads = fold([
        attached("idf_a"),
        attached("idf_b", { value: "sam@b.dev", domain: "b.dev" }),
        {
          type: "lw.identity.user_erased",
          occurredAt: T0 + 1,
          data: {
            userId: USER,
            // The writer's audit list is not the sweep's bound.
            erasedIdentifierIds: ["idf_a"],
            actor: { type: "system", id: "ops:erasure-request" },
          },
        },
      ]);
      const rows = Object.values(heads.identifiers);
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row.value).toBeNull();
        expect(row.identifierHash).toBeNull();
        expect(row.domain).not.toBeNull();
      }
    });
  });

  describe("when a verify names an identifier the heads lack", () => {
    it("folds conservatively: nothing appears, nothing throws", () => {
      const heads = fold([
        {
          type: "lw.identity.identifier_verified",
          occurredAt: T0,
          data: {
            identifierId: "idf_unknown",
            verificationId: null,
            method: "creation",
            actor: ACTOR,
          },
        },
      ]);
      expect(heads.identifiers).toEqual({});
    });
  });
});
