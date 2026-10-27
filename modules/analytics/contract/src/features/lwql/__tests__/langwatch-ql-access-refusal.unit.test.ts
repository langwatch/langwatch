/**
 * The classifier reads violations off a handled error's `meta`, so it is handed whatever the
 * wire carried: it answers "access" only when every violation says what the caller lacks.
 * @see modules/analytics/specs/dashboard-widget-frame-states.feature
 */
import { describe, expect, it } from "vitest";

import { findLangWatchQLMissingGates } from "../langwatch-ql-access-refusal.ts";

describe("findLangWatchQLMissingGates", () => {
  describe("given violations that each name the gates the caller lacks", () => {
    it("answers every gate once, sorted", () => {
      expect(
        findLangWatchQLMissingGates([
          { code: "GATED_COLUMN", missingGates: ["cost:view"] },
          { code: "APP_FUNCTION_GATED", missingGates: ["output", "cost:view"] },
        ]),
      ).toEqual(["cost:view", "output"]);
    });
  });

  describe("given one violation that names no gate", () => {
    /** @scenario "A refusal about the query's shape is not one of access" */
    it("answers no gate, so the refusal is not one of access", () => {
      expect(
        findLangWatchQLMissingGates([
          { code: "GATED_COLUMN", missingGates: ["cost:view"] },
          { code: "SETTINGS_CLAUSE" },
        ]),
      ).toEqual([]);
    });
  });

  describe("given something that is not a list of violations", () => {
    it.each([
      ["no violations", []],
      ["nothing", undefined],
      ["a violation that is not an object", ["GATED_COLUMN"]],
      ["an empty gate list", [{ missingGates: [] }]],
      ["gates that are not text", [{ missingGates: [1, null] }]],
      ["a gate list that is not a list", [{ missingGates: "cost:view" }]],
    ])("answers no gate for %s", (_case, violations) => {
      expect(findLangWatchQLMissingGates(violations)).toEqual([]);
    });
  });
});
