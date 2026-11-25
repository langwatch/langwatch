// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see enterprise/modules/nurturing/specs/gateway-facts.feature
 */
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  erasedUserHashOf,
  foldVirtualKeyFact,
  foldVirtualKeyFactWithoutErased,
  forgetPersonOnKey,
  isLiveKey,
  isPersonKey,
  type NurturingVirtualKey,
  type NurturingVirtualKeyFact,
} from "../nurturing-virtual-key.rules.ts";

const fact = (overrides: Partial<NurturingVirtualKeyFact>): NurturingVirtualKeyFact => ({
  virtualKeyId: "vk_1",
  organizationId: "org-1",
  action: "created",
  name: "Jane's key",
  actorUserId: "user-creator",
  principalUserId: "user-holder",
  purpose: "USER",
  occurredAt: 1_000,
  ...overrides,
});

/** Folds the facts in the order given, from no copy. */
function foldAll(facts: readonly NurturingVirtualKeyFact[]): NurturingVirtualKey {
  let held: NurturingVirtualKey | null = null;
  for (const next of facts) held = foldVirtualKeyFact({ held, fact: next });
  if (!held) throw new Error("a copy needs at least one fact");
  return held;
}

describe("foldVirtualKeyFact", () => {
  describe("when a key is rotated under a new name, then disabled", () => {
    /** @scenario "Rotating, disabling, enabling or revoking a key sends nothing and updates the key copy" */
    it("holds the new name and the disable, and keeps the created fact's creator", () => {
      const key = foldAll([
        fact({}),
        fact({ action: "rotated", name: "Renamed", actorUserId: "user-other", occurredAt: 2_000 }),
        fact({ action: "disabled", name: "Renamed", actorUserId: "user-other", occurredAt: 3_000 }),
      ]);

      expect(key).toMatchObject({
        name: "Renamed",
        occurredAt: 3_000,
        keyCreatedAt: 1_000,
        creatorUserId: "user-creator",
        disabledAt: 3_000,
      });
      expect(isLiveKey(key)).toBe(false);
    });
  });

  describe("when the created fact arrives after a later rotation", () => {
    it("still copies its creator, and keeps the later fact's name", () => {
      const key = foldAll([
        fact({ action: "rotated", name: "Renamed", actorUserId: null, occurredAt: 2_000 }),
        fact({}),
      ]);

      expect(key).toMatchObject({ name: "Renamed", creatorUserId: "user-creator" });
    });
  });

  describe("when a later fact names no holder and an older one arrives late naming another", () => {
    it("keeps the latest non-null holder by the fact's time, not by arrival", () => {
      const key = foldAll([
        fact({ principalUserId: "user-first", occurredAt: 1_000 }),
        fact({ action: "rotated", principalUserId: "user-latest", occurredAt: 3_000 }),
        fact({ action: "rotated", principalUserId: null, purpose: null, occurredAt: 4_000 }),
        fact({ action: "rotated", principalUserId: "user-middle", occurredAt: 2_000 }),
      ]);

      expect(key).toMatchObject({ principalUserId: "user-latest", purpose: "USER" });
    });
  });

  describe("when a USER fact is followed by a later LANGY one", () => {
    /** @scenario "Rotating, disabling, enabling or revoking a key sends nothing and updates the key copy" */
    it("takes the later purpose, in arrival order or out of it", () => {
      const user = fact({ purpose: "USER", occurredAt: 1_000 });
      const langy = fact({ action: "rotated", purpose: "LANGY", occurredAt: 2_000 });

      expect(foldAll([user, langy])).toMatchObject({ purpose: "LANGY", purposeAt: 2_000 });
      expect(foldAll([langy, user])).toMatchObject({ purpose: "LANGY", purposeAt: 2_000 });
    });
  });

  describe("when every fact is delivered twice", () => {
    it("holds what one delivery of each holds", () => {
      const facts = [
        fact({}),
        fact({ action: "disabled", occurredAt: 2_000 }),
        fact({ action: "enabled", occurredAt: 3_000 }),
      ];

      expect(foldAll([...facts, ...facts])).toEqual(foldAll(facts));
    });
  });
});

describe("isLiveKey", () => {
  describe("given a key disabled and then enabled again", () => {
    it("is live, and stops being live once revoked", () => {
      const enabled = foldAll([
        fact({}),
        fact({ action: "disabled", occurredAt: 2_000 }),
        fact({ action: "enabled", occurredAt: 3_000 }),
      ]);
      const revoked = foldAll([
        fact({}),
        fact({ action: "disabled", occurredAt: 2_000 }),
        fact({ action: "enabled", occurredAt: 3_000 }),
        fact({ action: "revoked", occurredAt: 4_000 }),
      ]);

      expect(isLiveKey(enabled)).toBe(true);
      expect(isLiveKey(revoked)).toBe(false);
    });
  });
});

describe("isPersonKey", () => {
  describe("given a fact stored before gateway recorded the purpose", () => {
    it("reads a null purpose as USER, and LANGY and CONNECT as no person's", () => {
      expect(isPersonKey(null)).toBe(true);
      expect(isPersonKey("USER")).toBe(true);
      expect(isPersonKey("LANGY")).toBe(false);
      expect(isPersonKey("CONNECT")).toBe(false);
    });
  });
});

describe("forgetPersonOnKey", () => {
  describe("given a key its erased holder also created", () => {
    /** @scenario "An erased person's key falls to the organization's admin" */
    it("names neither of them and keeps the holder's stamp", () => {
      const key = foldAll([fact({ actorUserId: "user-jane", principalUserId: "user-jane" })]);

      expect(forgetPersonOnKey({ key, userId: "user-jane" })).toMatchObject({
        creatorUserId: null,
        principalUserId: null,
        principalUserIdAt: 1_000,
      });
    });
  });

  describe("given a fact naming the erased holder, stamped after their stamp but before the erasure", () => {
    /** @scenario "A fact stamped before an erasure never names the erased holder again" */
    it("folds in naming no one, so the late fact cannot write them back", () => {
      const key = foldAll([fact({ principalUserId: "user-jane", occurredAt: 1_000 })]);
      const forgotten = forgetPersonOnKey({ key, userId: "user-jane" });

      const late = foldVirtualKeyFactWithoutErased({
        held: forgotten,
        fact: fact({ action: "rotated", principalUserId: "user-jane", occurredAt: 2_000 }),
        isErased: (id) => id === "user-jane",
      });

      expect(late).toMatchObject({ principalUserId: null, principalUserIdAt: 2_000 });
    });
  });

  describe("given a holder change to another person, stamped before the erasure, landing after it", () => {
    /** @scenario "A holder change to another person, stamped before an erasure, still lands after it" */
    it("makes that person the holder, as when it landed before the erasure", () => {
      const key = foldAll([fact({ principalUserId: "user-jane", occurredAt: 1_000 })]);
      const forgotten = forgetPersonOnKey({ key, userId: "user-jane" });

      const late = foldVirtualKeyFact({
        held: forgotten,
        fact: fact({ action: "rotated", principalUserId: "user-other", occurredAt: 2_000 }),
      });

      expect(late).toMatchObject({ principalUserId: "user-other", principalUserIdAt: 2_000 });
    });
  });

  describe("given a key the erased person neither holds nor made", () => {
    it("leaves its holder and stamp as they were", () => {
      const key = foldAll([fact({})]);

      expect(forgetPersonOnKey({ key, userId: "user-jane" })).toEqual(key);
    });
  });
});

describe("foldVirtualKeyFactWithoutErased", () => {
  const janeErased = (id: string) => id === "user-jane";

  describe("given a created fact naming an erased creator and a holder who is not erased", () => {
    it("folds it as the plain fold does, naming no creator", () => {
      const named = fact({ actorUserId: "user-jane", principalUserId: "user-holder" });

      const key = foldVirtualKeyFactWithoutErased({
        held: null,
        fact: named,
        isErased: janeErased,
      });

      expect(key).toEqual({ ...foldAll([named]), creatorUserId: null });
    });
  });

  describe("given a fact naming an erased holder later than the key's holder", () => {
    /** @scenario "A late fact naming an erased person ends the key with no holder, as if it landed first" */
    it("leaves no holder, stamped with the fact, so an older fact cannot fill it", () => {
      const held = foldAll([fact({ principalUserId: "user-holder" })]);
      const late = fact({
        action: "rotated",
        actorUserId: null,
        principalUserId: "user-jane",
        occurredAt: 2_000,
      });

      const cleared = foldVirtualKeyFactWithoutErased({ held, fact: late, isErased: janeErased });
      const older = foldVirtualKeyFactWithoutErased({
        held: cleared,
        fact: fact({ action: "rotated", principalUserId: "user-other", occurredAt: 1_500 }),
        isErased: janeErased,
      });

      expect(cleared).toMatchObject({ principalUserId: null, principalUserIdAt: 2_000 });
      expect(older).toMatchObject({ principalUserId: null, principalUserIdAt: 2_000 });
    });
  });

  describe("given two holder facts at one stamp, one naming an erased person", () => {
    /** @scenario "Two holder facts at one stamp, one naming an erased person, end the same in either order" */
    it("makes the other person the holder in either order", () => {
      const naming = (principalUserId: string) =>
        fact({ action: "rotated", principalUserId, occurredAt: 2_000 });
      const foldBoth = (first: string, second: string) =>
        [naming(first), naming(second)].reduce<NurturingVirtualKey | null>(
          (held, next) =>
            foldVirtualKeyFactWithoutErased({ held, fact: next, isErased: janeErased }),
          null,
        );

      expect(foldBoth("user-jane", "user-next")).toMatchObject({
        principalUserId: "user-next",
        principalUserIdAt: 2_000,
      });
      expect(foldBoth("user-next", "user-jane")).toEqual(foldBoth("user-jane", "user-next"));
    });
  });

  describe("given a key its marked holder still holds, and a fact naming them only as actor", () => {
    it("leaves the holder for the erasure's clearing, as the Postgres upsert and re-check do", () => {
      const held = foldAll([fact({ principalUserId: "user-jane" })]);
      const rotated = fact({
        action: "rotated",
        actorUserId: "user-jane",
        principalUserId: null,
        occurredAt: 2_000,
      });

      expect(
        foldVirtualKeyFactWithoutErased({ held, fact: rotated, isErased: janeErased }),
      ).toMatchObject({ creatorUserId: "user-creator", principalUserId: "user-jane" });
    });
  });

  describe("given a fact naming an erased holder earlier than the key's holder", () => {
    it("leaves the key's holder and stamp as they were", () => {
      const held = foldAll([fact({ principalUserId: "user-holder", occurredAt: 3_000 })]);
      const older = fact({ action: "rotated", principalUserId: "user-jane", occurredAt: 2_000 });

      expect(
        foldVirtualKeyFactWithoutErased({ held, fact: older, isErased: janeErased }),
      ).toMatchObject({ principalUserId: "user-holder", principalUserIdAt: 3_000 });
    });
  });
});

describe("erasedUserHashOf", () => {
  describe("given an account id", () => {
    it("is a stable SHA-256 hex that differs per id and holds no trace of the id", () => {
      const hash = erasedUserHashOf("user-jane");

      expect(hash).toMatch(/^[0-9a-f]{64}$/);
      expect(erasedUserHashOf("user-jane")).toBe(hash);
      expect(erasedUserHashOf("user-john")).not.toBe(hash);
      expect(hash).not.toContain("user-jane");
    });
  });

  describe("given the bare SHA-256 a delivery claim key carries for the same id", () => {
    it("matches neither it nor its prefix, so the two cannot be joined", () => {
      const bare = createHash("sha256").update("user-jane").digest("hex");

      expect(erasedUserHashOf("user-jane")).not.toBe(bare);
      expect(erasedUserHashOf("user-jane").startsWith(bare.slice(0, 16))).toBe(false);
    });
  });
});
