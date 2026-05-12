/**
 * @vitest-environment node
 *
 * Regression coverage for #3197 — judge prompt must not leak the scenario
 * Situation into the success bar. The prompt builder is the seam.
 * @see specs/scenarios/adapter-and-worker-resilience.feature
 */
import { describe, expect, it } from "vitest";
import { buildCriteriaOnlyJudgePrompt } from "../criteria-only-judge-prompt";

describe("buildCriteriaOnlyJudgePrompt", () => {
  it("renders every criterion as a numbered line inside <criteria>", () => {
    const prompt = buildCriteriaOnlyJudgePrompt([
      "Agent apologises",
      "Agent offers refund",
    ]);
    expect(prompt).toContain("1. Agent apologises");
    expect(prompt).toContain("2. Agent offers refund");
    expect(prompt).toContain("<criteria>");
    expect(prompt).toContain("</criteria>");
  });

  it("does not contain a <scenario> block", () => {
    const prompt = buildCriteriaOnlyJudgePrompt(["Agent apologises"]);
    expect(prompt).not.toContain("<scenario>");
    expect(prompt).not.toContain("</scenario>");
  });

  it("instructs the judge to treat criteria as the sole success bar", () => {
    const prompt = buildCriteriaOnlyJudgePrompt(["Anything"]);
    expect(prompt).toContain("ONLY success bar");
  });

  it("falls back to a sentinel string when criteria is empty", () => {
    const prompt = buildCriteriaOnlyJudgePrompt([]);
    expect(prompt).toContain("No criteria provided");
  });

  it("does not echo any provided situation text", () => {
    const situation = "Customer is angry about delayed delivery";
    const prompt = buildCriteriaOnlyJudgePrompt([
      "Agent stays polite",
      // Even if some hypothetical caller crammed the situation into the
      // criteria list, the builder still treats it as a criterion verbatim
      // — but the function itself must never echo a stand-alone situation.
    ]);
    expect(prompt).not.toContain(situation);
  });
});
