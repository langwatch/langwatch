// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see enterprise/modules/nurturing/specs/gateway-facts.feature
 */
import { describe, expect, it } from "vitest";

import {
  foldVirtualKeyFact,
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
    it("names neither of them and moves the holder's stamp to the erasure", () => {
      const key = foldAll([fact({ actorUserId: "user-jane", principalUserId: "user-jane" })]);

      expect(forgetPersonOnKey({ key, userId: "user-jane", erasedAt: 3_000 })).toMatchObject({
        creatorUserId: null,
        principalUserId: null,
        principalUserIdAt: 3_000,
      });
    });
  });

  describe("given a fact naming the erased holder, stamped after their stamp but before the erasure", () => {
    /** @scenario "A fact stamped before an erasure never names the erased holder again" */
    it("folds in naming no one, so the late fact cannot write them back", () => {
      const key = foldAll([fact({ principalUserId: "user-jane", occurredAt: 1_000 })]);
      const forgotten = forgetPersonOnKey({ key, userId: "user-jane", erasedAt: 3_000 });

      const late = foldVirtualKeyFact({
        held: forgotten,
        fact: fact({ action: "rotated", principalUserId: "user-jane", occurredAt: 2_000 }),
      });

      expect(late).toMatchObject({ principalUserId: null, principalUserIdAt: 3_000 });
    });
  });

  describe("given a key the erased person neither holds nor made", () => {
    it("leaves its holder and stamp as they were", () => {
      const key = foldAll([fact({})]);

      expect(forgetPersonOnKey({ key, userId: "user-jane", erasedAt: 3_000 })).toEqual(key);
    });
  });
});
