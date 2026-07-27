/**
 * @vitest-environment node
 *
 * The objective catalogue is a claim about coverage: putting a taxonomy code
 * on a row tells someone their run maps to that category. These tests keep
 * that claim honest — the codes have to be real, every category has to be
 * either offered or consciously excluded, and the menu has to stay short
 * enough to read.
 */
import { describe, expect, it } from "vitest";
import {
  EXCLUDED_TAXONOMY_CODES,
  RED_TEAM_OBJECTIVE_GROUPS,
  RED_TEAM_OBJECTIVES,
} from "../redTeamObjectives";

const codesOf = (objectives: { code?: string }[]) =>
  objectives.map((o) => o.code).filter((c): c is string => c !== undefined);

/** @see https://genai.owasp.org/llm-top-10/ */
const OWASP_LLM_TOP_10_2025 = Array.from(
  { length: 10 },
  (_, i) => `LLM${String(i + 1).padStart(2, "0")}`,
);

/** @see https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/ */
const OWASP_AGENTIC_TOP_10_2026 = Array.from(
  { length: 10 },
  (_, i) => `ASI${String(i + 1).padStart(2, "0")}`,
);

const KNOWN_CODES = [...OWASP_LLM_TOP_10_2025, ...OWASP_AGENTIC_TOP_10_2026];

describe("the red-team objective catalogue", () => {
  describe("given the taxonomy codes it advertises", () => {
    it("uses only real OWASP identifiers", () => {
      for (const code of codesOf(RED_TEAM_OBJECTIVES)) {
        expect(KNOWN_CODES).toContain(code);
      }
    });

    it("offers each category at most once", () => {
      const codes = codesOf(RED_TEAM_OBJECTIVES);

      expect(new Set(codes).size).toBe(codes.length);
    });

    it("leaves out every category a conversation cannot reach", () => {
      const codes = codesOf(RED_TEAM_OBJECTIVES);

      for (const excluded of EXCLUDED_TAXONOMY_CODES) {
        expect(codes).not.toContain(excluded);
      }
    });

    it("accounts for both taxonomies in full — offered or excluded, never dropped", () => {
      // Catches the case where a category is neither offered nor consciously
      // excluded, which is how a coverage gap appears without anyone deciding.
      const accountedFor = new Set([
        ...codesOf(RED_TEAM_OBJECTIVES),
        ...EXCLUDED_TAXONOMY_CODES,
      ]);

      for (const code of KNOWN_CODES) {
        expect([...accountedFor]).toContain(code);
      }
    });
  });

  describe("given a safety harm, which has no public numbering", () => {
    it("carries no code rather than an invented one", () => {
      const safety = RED_TEAM_OBJECTIVE_GROUPS.find(
        (g) => g.label === "Safety",
      );

      expect(safety).toBeDefined();
      for (const objective of safety!.objectives) {
        expect(objective.code).toBeUndefined();
      }
    });
  });

  describe("given the groups", () => {
    it("names a source for the ones taken from a standard", () => {
      for (const group of RED_TEAM_OBJECTIVE_GROUPS) {
        const hasCodes = codesOf(group.objectives).length > 0;

        expect(hasCodes ? !!group.source : group.source === undefined).toBe(
          true,
        );
      }
    });

    it("covers all three of security, agentic and safety", () => {
      // The groups are what tell someone red teaming is more than one thing.
      const labels = RED_TEAM_OBJECTIVE_GROUPS.map((g) => g.label);

      expect(labels).toContain("Security");
      expect(labels).toContain("Agentic");
      expect(labels).toContain("Safety");
    });

    it("stays short enough to scan", () => {
      // A picker is only useful while it can be read. Past roughly twenty rows
      // it is a document, and the answer would be search rather than more rows.
      expect(RED_TEAM_OBJECTIVES.length).toBeLessThanOrEqual(20);
      expect(RED_TEAM_OBJECTIVE_GROUPS.length).toBeLessThanOrEqual(4);
    });
  });

  describe("given the objectives themselves", () => {
    it("writes each one as a concrete outcome, not a vague one", () => {
      // The SDK plans, scores and adapts off this string; "break the agent"
      // plans badly. Every preset names something specific to achieve.
      for (const objective of RED_TEAM_OBJECTIVES) {
        expect(objective.target.length).toBeGreaterThan(40);
      }
    });

    it("explains what the category means in one line", () => {
      for (const objective of RED_TEAM_OBJECTIVES) {
        expect(objective.label.length).toBeGreaterThan(0);
        expect(objective.summary.length).toBeGreaterThan(20);
        expect(objective.summary.length).toBeLessThan(70);
      }
    });
  });
});
