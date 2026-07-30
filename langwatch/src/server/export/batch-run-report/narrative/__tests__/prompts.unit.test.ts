/**
 * Unit tests for the two system prompts.
 *
 * The narrative pass ran through OpenAI's `json_object` response format for
 * every real project tested, and that mode's own API rejects any request
 * whose messages never say the word "json" — a rule that has nothing to do
 * with this report's content and everything to do with the wire protocol.
 * Get it wrong and every report silently degrades to figures_only, since a
 * failed model call is indistinguishable from an absent one from the
 * service's point of view. These tests, and the module-load assertion in
 * prompts.ts, exist so a future prompt edit cannot reintroduce that failure
 * quietly.
 *
 * @see specs/scenarios/scenario-run-report.feature
 */
import { describe, expect, it } from "vitest";
import {
  buildNarrativeSystemPrompt,
  mentionsJson,
  VERIFIER_SYSTEM_PROMPT,
} from "../prompts";

describe("mentionsJson()", () => {
  it("is case-insensitive", () => {
    expect(mentionsJson("Respond with JSON.")).toBe(true);
    expect(mentionsJson("respond with json.")).toBe(true);
  });

  it("does not match json as a substring of another word", () => {
    expect(mentionsJson("this contains jsonify but not the word itself")).toBe(
      false,
    );
  });

  it("is false when the word is absent", () => {
    expect(mentionsJson("Answer the questions below.")).toBe(false);
  });
});

describe("the narrative system prompt", () => {
  /** @scenario A report still downloads when the analysis fails */
  it("mentions json, satisfying OpenAI's json_object response format rule", () => {
    const prompt = buildNarrativeSystemPrompt({ questions: [] });

    expect(mentionsJson(prompt)).toBe(true);
  });
});

describe("the verifier system prompt", () => {
  it("mentions json, satisfying OpenAI's json_object response format rule", () => {
    expect(mentionsJson(VERIFIER_SYSTEM_PROMPT)).toBe(true);
  });
});
