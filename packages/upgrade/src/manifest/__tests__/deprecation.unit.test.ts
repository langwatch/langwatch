import { describe, expect, it } from "vitest";

import { loadDeprecations, parseDeprecations } from "../deprecation.ts";
import { ManifestLoadError } from "../manifest.ts";

function entry(overrides: Record<string, unknown> = {}) {
  return {
    id: "postgres:OldTable",
    what: "Postgres table OldTable",
    kind: "postgres-table",
    deprecatedIn: "3.22.0",
    removedIn: null,
    notice: "Nothing reads it.",
    ...overrides,
  };
}

function refusalOf(load: () => unknown): ManifestLoadError {
  try {
    load();
  } catch (error) {
    if (error instanceof ManifestLoadError) return error;
    throw error;
  }
  throw new Error("expected the register to be refused");
}

describe("the deprecation register", () => {
  describe("given the register this image ships", () => {
    /** @scenario "The shipped deprecation register names the retired project scope tables" */
    it("names both project scope tables, their successor and a future removal", () => {
      const register = loadDeprecations();
      expect(
        register.map(({ id, kind, removedIn, successor }) => ({ id, kind, removedIn, successor })),
      ).toEqual(
        expect.arrayContaining([
          {
            id: "postgres:DataPrivacyProjectScope",
            kind: "postgres-table",
            removedIn: null,
            successor: "Project and Team placement",
          },
          {
            id: "postgres:DataRetentionProjectScope",
            kind: "postgres-table",
            removedIn: null,
            successor: "Project and Team placement",
          },
        ]),
      );
    });
  });

  describe("given an entry removed before it is deprecated", () => {
    /** @scenario "A deprecation removed before it is deprecated, or named twice, is refused" */
    it("refuses naming the entry and both releases", () => {
      const text = JSON.stringify([entry({ removedIn: "3.21.0" })]);
      const refusal = refusalOf(() => parseDeprecations({ text }));
      expect(refusal.code).toBe("invalid_manifest");
      expect(refusal.message).toContain("postgres:OldTable");
      expect(refusal.message).toContain("3.21.0");
      expect(refusal.message).toContain("3.22.0");
    });

    it("refuses an id named twice", () => {
      const text = JSON.stringify([entry(), entry()]);
      expect(refusalOf(() => parseDeprecations({ text })).message).toContain("twice");
    });
  });
});
