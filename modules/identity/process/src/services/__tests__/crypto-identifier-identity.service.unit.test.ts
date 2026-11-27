import {
  IDENTIFIER_ATTACHED_EVENT_TYPE,
  type IdentityFactInput,
  normalizeIdentifierValue,
} from "@langwatch/identity-contract";
import { Ksuid } from "@langwatch/ksuid";
import { describe, expect, it } from "vitest";

import {
  attachData,
  fact,
  headsWith,
  InMemoryHeads,
  USER,
} from "../../__tests__/support/in-memory-heads.ts";
import { InMemoryReservations } from "../../__tests__/support/in-memory-reservations.ts";
import { InMemoryUsers } from "../../__tests__/support/in-memory-users.ts";
import { CryptoIdentifierIdentityService } from "../crypto-identifier-identity.service.ts";
import { IdentityGuardsService } from "../identity-guards.service.ts";

const identifiers = CryptoIdentifierIdentityService.create();
const data = attachData();
const input = {
  userId: data.userId,
  provider: data.provider,
  providerAccountId: data.providerAccountId,
  normalizedValue: normalizeIdentifierValue(data.value),
  occurredAtMs: data.occurredAtMs,
};
const candidates = identifiers.deriveIdentifierIdCandidates(input);

function guardsOver(heads: InMemoryHeads): IdentityGuardsService {
  heads.hashKeys.set(USER, "key_material");
  return IdentityGuardsService.create({
    heads,
    users: new InMemoryUsers(),
    reservations: new InMemoryReservations(),
    identifiers,
  });
}

function statedIdentifierIds(facts: IdentityFactInput[]): string[] {
  return facts.flatMap((stated) =>
    stated.type === IDENTIFIER_ATTACHED_EVENT_TYPE ? [stated.data.identifierId] : [],
  );
}

function legacyHeads({ newborn }: { newborn: boolean }): InMemoryHeads {
  const heads = new InMemoryHeads();
  heads.heads.set(
    USER,
    headsWith(
      fact({ identifierId: candidates.legacy, provider: "google", value: input.normalizedValue }),
    ),
  );
  if (newborn) heads.newborns.add(USER);
  return heads;
}

describe("identifier id layout", () => {
  it("derives two distinct candidates, one per layout", () => {
    expect(Ksuid.parse(candidates.v2).layout).toBe("v2");
    expect(Ksuid.parse(candidates.legacy).layout).toBe("v1-legacy");
    expect(candidates.v2).not.toBe(candidates.legacy);
  });

  describe("when no row holds the identifier", () => {
    /** @scenario "A new identifier gets a v2 id" */
    it("states the v2 candidate", async () => {
      const facts = await guardsOver(new InMemoryHeads()).attachIdentifier(data);

      expect(statedIdentifierIds(facts)).toEqual([candidates.v2]);
    });

    /** @scenario "Attaching the same identifier twice gives one row" */
    it("folds the first attach and states nothing on the second", async () => {
      const heads = new InMemoryHeads();
      const guards = guardsOver(heads);
      heads.fold(USER, await guards.attachIdentifier(data));

      const second = await guards.attachIdentifier({ ...data, commandId: "idcmd_2" });

      expect(second).toEqual([]);
      expect(Object.keys((await heads.findHeads({ userId: USER })).identifiers)).toEqual([
        candidates.v2,
      ]);
    });
  });

  describe("when a folded row holds the identifier under its legacy id", () => {
    /** @scenario "A legacy identifier is matched by its legacy id" */
    it("states nothing, so no v2 row lands beside it", async () => {
      const heads = legacyHeads({ newborn: false });

      const facts = await guardsOver(heads).attachIdentifier(data);

      expect(facts).toEqual([]);
      expect(Object.keys((await heads.findHeads({ userId: USER })).identifiers)).toEqual([
        candidates.legacy,
      ]);
    });
  });

  describe("when a newborn's provisional row holds the legacy id", () => {
    /** @scenario "A provisional legacy identifier keeps its legacy id" */
    it("states the legacy candidate", async () => {
      const facts = await guardsOver(legacyHeads({ newborn: true })).attachIdentifier(data);

      expect(statedIdentifierIds(facts)).toEqual([candidates.legacy]);
    });
  });

  describe("when a backfill pass plans an identifier its rows already hold", () => {
    /** @scenario "A backfill plan adopts a stored identifier under its legacy id" */
    it("reuses the legacy id the stored rows carry", () => {
      expect(
        identifiers.deriveIdentifierId({
          ...input,
          storedIdentifierIds: new Set(["idf_other", candidates.legacy]),
        }),
      ).toBe(candidates.legacy);
      expect(identifiers.deriveIdentifierId({ ...input, storedIdentifierIds: new Set() })).toBe(
        candidates.v2,
      );
    });
  });
});
