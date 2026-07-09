import { describe, expect, it } from "vitest";

import { hoistSystemMessage } from "../hoist-system-message";

describe("hoistSystemMessage", () => {
  describe("given a stored prompt whose system content lives in messages", () => {
    it("moves the system content into prompt", () => {
      const result = hoistSystemMessage({
        prompt: "",
        messages: [
          { role: "system", content: "You are a support bot." },
          { role: "user", content: "{{question}}" },
        ],
      });

      expect(result.prompt).toBe("You are a support bot.");
    });

    it("drops the system message so it is not sent twice", () => {
      const result = hoistSystemMessage({
        prompt: "",
        messages: [
          { role: "system", content: "You are a support bot." },
          { role: "user", content: "{{question}}" },
        ],
      });

      expect(result.messages).toEqual([
        { role: "user", content: "{{question}}" },
      ]);
    });
  });

  describe("given a stored prompt carrying both a prompt and a system message", () => {
    // `createPrompt` rejects this combination with SystemPromptConflictError, so
    // a prompt read back from storage cannot be handed straight back to it.
    it("keeps the system message and discards the prompt field", () => {
      const result = hoistSystemMessage({
        prompt: "stale prompt column",
        messages: [{ role: "system", content: "authoritative system message" }],
      });

      expect(result.prompt).toBe("authoritative system message");
    });

    it("leaves no system message behind to conflict with the prompt", () => {
      const result = hoistSystemMessage({
        prompt: "stale prompt column",
        messages: [{ role: "system", content: "authoritative system message" }],
      });

      expect(result.messages).toBeUndefined();
    });
  });

  describe("given a stored prompt with no system message", () => {
    it("passes the prompt field through untouched", () => {
      const result = hoistSystemMessage({
        prompt: "You are a support bot.",
        messages: [{ role: "user", content: "{{question}}" }],
      });

      expect(result.prompt).toBe("You are a support bot.");
      expect(result.messages).toEqual([
        { role: "user", content: "{{question}}" },
      ]);
    });
  });

  describe("given nothing to hoist", () => {
    it("reports absent fields as undefined rather than empty", () => {
      expect(hoistSystemMessage({ prompt: null, messages: null })).toEqual({
        prompt: undefined,
        messages: undefined,
      });

      expect(hoistSystemMessage({ prompt: "hi", messages: [] })).toEqual({
        prompt: "hi",
        messages: undefined,
      });
    });
  });
});
