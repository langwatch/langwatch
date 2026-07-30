import { LEGAL_MOUNT_SHAPES, validateMount } from "@langwatch/event-sourcing";
import { describe, expect, it } from "vitest";
import {
  assertCanonicalLogStorageMountIsLegal,
  canonicalLogStorageMount,
} from "../mount";

describe("the canonicalLogStorage mount", () => {
  /** @scenario a lane scoped to a declared partition is the unit of batching */
  it("is one of ADR-106's enumerated legal shapes", () => {
    expect(LEGAL_MOUNT_SHAPES).toContainEqual(canonicalLogStorageMount);
  });

  it("passes validateMount with no violations", () => {
    expect(validateMount(canonicalLogStorageMount)).toEqual([]);
  });

  /** @scenario The projection's mount is a map over an append store, not a fold */
  it("declares projection: map and store: append, and is accepted as legal", () => {
    expect(canonicalLogStorageMount.projection).toBe("map");
    expect(canonicalLogStorageMount.store).toBe("append");
    expect(validateMount(canonicalLogStorageMount)).toEqual([]);
    expect(LEGAL_MOUNT_SHAPES).toContainEqual(canonicalLogStorageMount);
  });

  it("does not throw when asserted at composition", () => {
    expect(() => assertCanonicalLogStorageMountIsLegal()).not.toThrow();
  });

  describe("given the mount were mistakenly declared as a fold", () => {
    it("is refused for scoping wider than one aggregate", () => {
      const violations = validateMount({
        ...canonicalLogStorageMount,
        projection: "fold",
        store: "replace",
      });
      expect(violations.map((v) => v.rule)).toContain(
        "fold-scope-must-be-aggregate",
      );
    });
  });

  describe("given the mount were mistakenly declared on a merge store", () => {
    it("is refused because merge is closed to new adopters", () => {
      const violations = validateMount({
        ...canonicalLogStorageMount,
        store: "merge",
        idempotency: "whole-bucket-replace",
      });
      expect(violations.map((v) => v.rule)).toContain(
        "merge-closed-to-new-adopters",
      );
    });
  });
});
