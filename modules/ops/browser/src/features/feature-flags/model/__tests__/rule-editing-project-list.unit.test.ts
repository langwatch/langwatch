/**
 * The project scope in the targeting rules dialog: a stored rule naming several
 * projects opens with every id, and what the operator types is stored as one id
 * or a list.
 * @see specs/ops/internal-feature-flags.feature
 */
import { describe, expect, it } from "vitest";

import { findUnfillableRule, rulesToUI, uiToRules } from "../rule-editing.ts";
import { summarizeTargeting } from "../targeting-summary.ts";

describe("given a stored rule enabling the flag for three projects", () => {
  const stored = [{ match: { projectId: ["project_a", "project_b", "project_c"] }, enabled: true }];

  describe("when the rule is opened in the targeting rules dialog", () => {
    /** @scenario "the ops page reads and writes a project rule naming several projects" */
    it("shows as a project rule with every id and saves them back", () => {
      const ui = rulesToUI(stored);

      expect(ui[0]).toMatchObject({
        scopeKind: "PROJECT",
        target: "project_a, project_b, project_c",
        otherConditions: {},
      });
      expect(uiToRules(ui)).toEqual(stored);
    });
  });

  describe("when the operator removes one id from the field", () => {
    /** @scenario "the ops page reads and writes a project rule naming several projects" */
    it("stores the remaining ids, and a single id as a string", () => {
      const [rule] = rulesToUI(stored);
      if (!rule) throw new Error("expected one rule");

      expect(uiToRules([{ ...rule, target: "project_a, project_c" }])[0]?.match).toEqual({
        projectId: ["project_a", "project_c"],
      });
      expect(uiToRules([{ ...rule, target: " project_a , " }])[0]?.match).toEqual({
        projectId: "project_a",
      });
    });
  });

  describe("when the field holds no id", () => {
    it("is reported as unfillable rather than saved", () => {
      const [rule] = rulesToUI(stored);
      if (!rule) throw new Error("expected one rule");

      expect(findUnfillableRule([{ ...rule, target: " , " }])).toBeDefined();
      expect(findUnfillableRule([{ ...rule, target: "project_a" }])).toBeUndefined();
    });
  });

  describe("when the note under the toggle is summarised", () => {
    it("counts each listed project", () => {
      expect(summarizeTargeting(stored).enabledProjectCount).toBe(3);
    });
  });
});
