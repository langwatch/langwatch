import { Instance, Ksuid, type KsuidLayout } from "@langwatch/ksuid";
import { describe, expect, it } from "vitest";

import { emptyIdentityHeads, type IdentityFact, type IdentityHeads } from "../facts.ts";
import { reduceIdentity } from "../reduce.ts";

const USER = "user_sam";
// Low 16 bits non-zero, so the legacy and v2 spellings differ.
const SECONDS = 1_690_000_123;

function identifierId({
  layout,
  timestamp = SECONDS,
}: {
  layout: KsuidLayout;
  timestamp?: number;
}): string {
  return new Ksuid({
    environment: "prod",
    resource: "idf",
    timestamp,
    instance: new Instance(Instance.schemes.RANDOM, new Uint8Array(8).fill(7)),
    sequenceId: 42,
    layout,
  }).toString();
}

function attached({ id, occurredAt }: { id: string; occurredAt: number }): IdentityFact {
  return {
    type: "lw.identity.identifier_attached",
    occurredAt,
    data: {
      identifierId: id,
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
      actor: { type: "user", id: USER },
    },
  };
}

function fold(facts: IdentityFact[]): IdentityHeads {
  return facts.reduce(
    (heads, fact) => reduceIdentity({ heads, fact }),
    emptyIdentityHeads({ userId: USER }),
  );
}

describe("reduceIdentity across id layouts", () => {
  const legacy = identifierId({ layout: "v1-legacy" });
  const v2 = identifierId({ layout: "v2" });

  /** @scenario "A fact naming the other layout of a held identifier folds into the held row" */
  it("folds a v2 attach into the identifier held under its legacy id", () => {
    const heads = fold([
      attached({ id: legacy, occurredAt: SECONDS * 1000 }),
      attached({ id: v2, occurredAt: SECONDS * 1000 + 1 }),
    ]);

    expect(Object.keys(heads.identifiers)).toEqual([legacy]);
  });

  it("folds a legacy attach into the identifier held under its v2 id", () => {
    const heads = fold([
      attached({ id: v2, occurredAt: SECONDS * 1000 }),
      attached({ id: legacy, occurredAt: SECONDS * 1000 + 1 }),
    ]);

    expect(Object.keys(heads.identifiers)).toEqual([v2]);
  });

  it("folds a v2 id past 2106, which has no legacy spelling, under its own id", () => {
    const late = identifierId({ layout: "v2", timestamp: 2 ** 32 + 0x1234 });
    const heads = fold([attached({ id: late, occurredAt: SECONDS * 1000 })]);

    expect(Object.keys(heads.identifiers)).toEqual([late]);
  });
});
