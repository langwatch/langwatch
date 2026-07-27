/**
 * @vitest-environment node
 *
 * The objective catalogue is a claim about coverage: putting an OWASP code on
 * a chip tells someone their run maps to that category. These tests keep that
 * claim honest — the codes have to be real, and the ones no conversation can
 * reach have to stay out.
 */
import { describe, expect, it } from "vitest";
import { RED_TEAM_OBJECTIVES } from "../redTeamObjectives";

/**
 * Build- and training-time risks. A red-team run only talks to a deployed
 * agent, so offering these as objectives would promise coverage the run
 * cannot deliver.
 * @see https://genai.owasp.org/llm-top-10/
 */
const NOT_REACHABLE_BY_CONVERSATION = ["LLM03", "LLM04", "LLM10"];

const OWASP_LLM_TOP_10_2025 = [
  "LLM01",
  "LLM02",
  "LLM03",
  "LLM04",
  "LLM05",
  "LLM06",
  "LLM07",
  "LLM08",
  "LLM09",
  "LLM10",
];

describe("the red-team objective catalogue", () => {
  describe("given the OWASP codes it advertises", () => {
    it("uses only real Top 10 identifiers", () => {
      for (const objective of RED_TEAM_OBJECTIVES) {
        expect(OWASP_LLM_TOP_10_2025).toContain(objective.code);
      }
    });

    it("offers each category at most once", () => {
      const codes = RED_TEAM_OBJECTIVES.map((o) => o.code);

      expect(new Set(codes).size).toBe(codes.length);
    });

    it("leaves out the risks a conversation cannot reach", () => {
      const codes = RED_TEAM_OBJECTIVES.map((o) => o.code);

      for (const code of NOT_REACHABLE_BY_CONVERSATION) {
        expect(codes).not.toContain(code);
      }
    });
  });

  describe("given the objectives themselves", () => {
    it("writes each one as a concrete outcome, not a vague one", () => {
      // The SDK plans, scores and adapts off this string; "break the agent"
      // plans badly. Every preset names something specific to achieve.
      for (const objective of RED_TEAM_OBJECTIVES) {
        expect(objective.target.length).toBeGreaterThan(40);
        expect(objective.target).toMatch(/^(get|convince) the agent to /);
      }
    });

    it("explains what the category means in its own help text", () => {
      for (const objective of RED_TEAM_OBJECTIVES) {
        expect(objective.help).toContain(objective.code);
        expect(objective.label.length).toBeGreaterThan(0);
      }
    });
  });
});
