import { describe, expect, it } from "vitest";
import { GUIDED_KICKOFF_OPENER, isGuidedKickoffPrompt, prependSkillBody } from "./guided-kickoff.js";

// Backs the kickoff-turn rules of specs/langy/langy-guided-onboarding.feature:
// the worker recognises the brief the app sends and nothing else.

const BRIEF = [
  GUIDED_KICKOFF_OPENER,
  "Path to set up now: gateway (Gateway).",
  "Everything picked, in the order it was picked: gateway (Gateway).",
  "Provider: none connected yet.",
  "Organization: ACME. First name: Ada.",
  "Tour: skipped.",
].join("\n");

describe("isGuidedKickoffPrompt", () => {
  describe("when the prompt is the brief alone", () => {
    /** @scenario "The worker recognises the kickoff brief by its opener" */
    it("recognises it", () => {
      expect(isGuidedKickoffPrompt(BRIEF)).toBe(true);
    });
  });

  describe("when data rides ahead of the brief under the user-message label", () => {
    it("reads the brief after the last label", () => {
      const prompt = ["[Screen context]\nThe traces page.", `THE USER'S MESSAGE:\n${BRIEF}`].join("\n\n");
      expect(isGuidedKickoffPrompt(prompt)).toBe(true);
    });

    it("does not read a kickoff quoted in the data ahead of the label", () => {
      const prompt = [`Transcript:\nuser: ${BRIEF}`, "THE USER'S MESSAGE:\nwhat did I pick?"].join("\n\n");
      expect(isGuidedKickoffPrompt(prompt)).toBe(false);
    });
  });

  describe("when a later kickoff continues the conversation", () => {
    it("recognises the continuation line followed by the opener", () => {
      expect(isGuidedKickoffPrompt(`Let's set up Gateway then.\n${BRIEF}`)).toBe(true);
    });

    it("does not recognise the continuation line on its own", () => {
      expect(isGuidedKickoffPrompt("Let's set up Gateway then.\nWhere do I start?")).toBe(false);
    });
  });

  describe("when the prompt is an ordinary message", () => {
    it("recognises nothing, even one that mentions the kickoff later", () => {
      expect(isGuidedKickoffPrompt("show me traces")).toBe(false);
      expect(isGuidedKickoffPrompt(`Tell me about the ${GUIDED_KICKOFF_OPENER}`)).toBe(false);
    });
  });
});

describe("prependSkillBody", () => {
  it("frames the skill ahead of the message and keeps the message last", () => {
    const prompt = prependSkillBody({ prompt: BRIEF, name: "guided-onboarding", body: "# Skill\n\nDo this.\n" });
    const lines = prompt.split("\n");
    expect(lines[0]).toContain('[Skill "guided-onboarding"');
    expect(prompt).toContain("# Skill\n\nDo this.\n[End of skill.");
    expect(prompt.endsWith(`\n\n${BRIEF}`)).toBe(true);
  });
});
