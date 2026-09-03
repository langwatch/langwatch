/**
 * @vitest-environment node
 *
 * Replay parity for the `Identifier` projection (ADR-101 §3).
 *
 * The claim is not "the reducer is deterministic" — folding one list twice
 * proves nothing an assignment would not. The claim is that the projection
 * MAINTAINED INCREMENTALLY equals the one rebuilt from scratch: the live path
 * loads the rows it wrote, folds one event onto them and writes them back,
 * over and over, and every one of those round trips crosses the row shape.
 * A column the mapping loses, a field the reducer needs and the row cannot
 * carry, a state that only survives in memory — each shows up as a difference
 * here and nowhere else.
 *
 * The store is in memory but the ROW SHAPE is the real one: `factToRow` and
 * `rowToFact` are what the Prisma repository writes and reads.
 */
import {
  emptyIdentityHeads,
  type IdentityFact,
  type IdentityHeads,
  reduceIdentity,
} from "@langwatch/identity-contract";
import { describe, expect, it } from "vitest";
import {
  identifierFactToRow,
  identifierRowToFact,
  type IdentifierRow,
} from "../repositories/prisma/prisma.identifier.mapper";

const USER = "user_sam";
const ACTOR = { type: "user" as const, id: USER };
const T0 = 1_690_000_000_000;

function attached(
  identifierId: string,
  overrides?: Record<string, unknown> & { occurredAt?: number },
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
  } as IdentityFact;
}

const history: IdentityFact[] = [
  attached("idf_google", {
    provider: "google",
    providerId: "auth0",
    issuer: "local:oauth:auth0",
    providerAccountId: "auth0|42",
    accountId: "acc_1",
    state: "VERIFIED",
  }),
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

/** The live path: load rows, fold ONE event onto them, write them back. */
function maintainIncrementally(facts: IdentityFact[]): IdentifierRow[] {
  const rows = new Map<string, IdentifierRow>();
  for (const fact of facts) {
    const heads: IdentityHeads = {
      userId: USER,
      identifiers: Object.fromEntries(
        [...rows.values()].map((row) => {
          const loaded = identifierRowToFact(row);
          return [loaded.identifierId, loaded];
        }),
      ),
    };
    const next = reduceIdentity({ heads, fact });
    for (const head of Object.values(next.identifiers)) {
      rows.set(head.identifierId, identifierFactToRow(head));
    }
  }
  return sorted([...rows.values()]);
}

/** The rebuild: one fold over the whole history, written once. */
function rebuildFromScratch(facts: IdentityFact[]): IdentifierRow[] {
  const heads = facts.reduce(
    (state, fact) => reduceIdentity({ heads: state, fact }),
    emptyIdentityHeads({ userId: USER }),
  );
  return sorted(Object.values(heads.identifiers).map(identifierFactToRow));
}

const sorted = (rows: IdentifierRow[]): IdentifierRow[] =>
  [...rows].sort((left, right) => left.id.localeCompare(right.id));

describe("the Identifier projection", () => {
  describe("when the same history is maintained incrementally and rebuilt from scratch", () => {
    /** @scenario "Replay rebuilds the Identifier projection identically" */
    it("produces the same rows, whole-row", () => {
      const live = maintainIncrementally(history);
      const replayed = rebuildFromScratch(history);

      expect(replayed).toEqual(live);
      expect(live.map((row) => row.state)).toEqual(["PRIMARY", "DETACHED"]);
      // Every column the row carries survived the round trips, including the
      // ones only ADR-116 added.
      expect(live.find((row) => row.id === "idf_google")).toMatchObject({
        providerId: "auth0",
        issuer: "local:oauth:auth0",
        providerAccountId: "auth0|42",
        accountId: "acc_1",
      });
    });

    /** @scenario "Erasure wipes values and leaves a replayable tombstone" */
    it("reproduces the tombstone and never the address after an erasure", () => {
      const erased: IdentityFact[] = [
        ...history,
        {
          type: "lw.identity.user_erased",
          occurredAt: T0 + 5000,
          data: {
            userId: USER,
            erasedIdentifierIds: ["idf_email"],
            actor: { type: "system", id: "ops:erasure-request" },
          },
        },
      ];

      const live = maintainIncrementally(erased);

      expect(rebuildFromScratch(erased)).toEqual(live);
      for (const row of live) {
        expect(row.value).toBeNull();
        expect(row.identifierHash).toBeNull();
        expect(row.domain).not.toBeNull();
      }
    });
  });

  describe("when a fact is re-applied to rows that already carry it", () => {
    it("never regresses a later lifecycle state", () => {
      const replayed = maintainIncrementally([
        ...history,
        attached("idf_email", { occurredAt: T0 + 1000 }),
      ]);

      const email = replayed.find((row: IdentifierRow) => row.id === "idf_email");
      expect(email?.state).toBe("PRIMARY");
    });
  });
});
