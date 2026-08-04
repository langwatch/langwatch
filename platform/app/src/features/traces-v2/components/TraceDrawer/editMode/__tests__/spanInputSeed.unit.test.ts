import { describe, expect, it } from "vitest";
import { capturedInputForEditing } from "../spanInputSeed";

const MESSAGES = [
  { role: "user", content: "what is the weather" },
  { role: "assistant", content: "mild" },
];

const SYSTEM_PROMPT = "You are a weather assistant.";

/** What the reader's input panel shows: the prompt in front of the messages. */
const displayInput = JSON.stringify([
  { role: "system", content: SYSTEM_PROMPT },
  ...MESSAGES,
]);

describe("given a span whose system prompt is recorded apart from its messages", () => {
  describe("when the input editor is seeded", () => {
    /** @scenario "The system prompt shown with the messages is not edited into them" */
    it("leaves the prompt out of what the reviewer edits", () => {
      const seed = capturedInputForEditing({
        text: displayInput,
        params: { "gen_ai.system_instructions": SYSTEM_PROMPT },
      });

      expect(seed).toBe(JSON.stringify(MESSAGES));
    });

    /** @scenario "The system prompt shown with the messages is not edited into them" */
    it("reads the prompt from nested attributes as well", () => {
      const seed = capturedInputForEditing({
        text: displayInput,
        params: { gen_ai: { system_instructions: SYSTEM_PROMPT } },
      });

      expect(seed).toBe(JSON.stringify(MESSAGES));
    });
  });
});

describe("given a span whose messages carry their own system message", () => {
  describe("when the input editor is seeded", () => {
    /** @scenario "The system prompt shown with the messages is not edited into them" */
    it("keeps every message the trace recorded", () => {
      const recorded = JSON.stringify([
        { role: "system", content: "a different prompt" },
        ...MESSAGES,
      ]);

      const seed = capturedInputForEditing({
        text: recorded,
        params: { "gen_ai.system_instructions": SYSTEM_PROMPT },
      });

      expect(seed).toBe(recorded);
    });
  });
});

describe("given a span with no system prompt attribute", () => {
  describe("when the input editor is seeded", () => {
    /** @scenario "The system prompt shown with the messages is not edited into them" */
    it("seeds what was captured", () => {
      const recorded = JSON.stringify(MESSAGES);

      expect(capturedInputForEditing({ text: recorded, params: {} })).toBe(
        recorded,
      );
      expect(
        capturedInputForEditing({ text: "plain prose", params: null }),
      ).toBe("plain prose");
      expect(capturedInputForEditing({ text: null, params: null })).toBeNull();
    });
  });
});
