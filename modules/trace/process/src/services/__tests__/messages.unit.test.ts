import { describe, expect, it } from "vitest";

import {
  extractLastUserMessageText,
  extractMessageContentText,
  extractSystemInstructionFromMessages,
  stripLiftedSystemMessage,
} from "../../rules/canonical-message.rules.ts";

describe("extractMessageContentText", () => {
  describe("when content is a string", () => {
    it("returns the string directly", () => {
      expect(extractMessageContentText({ role: "user", content: "hello" })).toBe("hello");
    });
  });

  describe("when content is an array of parts", () => {
    it("extracts text from {text: ...} parts", () => {
      expect(
        extractMessageContentText({
          role: "user",
          content: [{ text: "hello" }],
        }),
      ).toBe("hello");
    });

    it("extracts text from {type: 'text', text: ...} parts", () => {
      expect(
        extractMessageContentText({
          role: "user",
          content: [{ type: "text", text: "hello" }],
        }),
      ).toBe("hello");
    });
  });

  describe("when content is an object with numeric keys (reconstructed from flattened OTEL attributes)", () => {
    it('extracts text from {"0": {"text": "..."}} format', () => {
      expect(
        extractMessageContentText({
          role: "user",
          content: { "0": { text: "🐤" } },
        }),
      ).toBe("🐤");
    });

    it("extracts text from multiple numeric keys", () => {
      expect(
        extractMessageContentText({
          role: "user",
          content: { "0": { text: "hello" }, "1": { text: " world" } },
        }),
      ).toBe("hello\n world");
    });
  });
});

describe("extractLastUserMessageText", () => {
  describe("when messages contain object-with-numeric-keys content", () => {
    it("extracts text from the last user message", () => {
      const messages = [{ role: "user", content: { "0": { text: "🐤" } } }];
      expect(extractLastUserMessageText(messages)).toBe("🐤");
    });
  });

  describe("when the conversation starts with a developer-role message (OpenAI Responses dialect)", () => {
    it("extracts the last user text, never the developer prompt", () => {
      const messages = [
        { role: "developer", content: "You are OpenCode, a helpful agent." },
        { role: "user", content: [{ type: "input_text", text: "hi" }] },
      ];
      expect(extractLastUserMessageText(messages)).toBe("hi");
    });
  });
});

describe("extractSystemInstructionFromMessages", () => {
  describe("when the first message is system-role", () => {
    it("extracts its content", () => {
      expect(
        extractSystemInstructionFromMessages([
          { role: "system", content: "be brief" },
          { role: "user", content: "hi" },
        ]),
      ).toBe("be brief");
    });
  });

  describe("when the first message uses the developer role", () => {
    it("treats it as the system instruction", () => {
      expect(
        extractSystemInstructionFromMessages([
          { role: "developer", content: "You are OpenCode." },
          { role: "user", content: "hi" },
        ]),
      ).toBe("You are OpenCode.");
    });
  });
});

describe("stripLiftedSystemMessage", () => {
  describe("when messages open with a system turn and carry a later one", () => {
    /** @scenario "A system message later in the conversation stays in the input messages" */
    it("removes only the lifted system turn and keeps the later one", () => {
      const stripped = stripLiftedSystemMessage([
        { role: "system", content: "be brief" },
        { role: "user", content: "hi" },
        { role: "system", content: "Retrieved context: opening hours 9 to 17" },
        { role: "assistant", content: "hello!" },
      ]);
      expect(stripped).toEqual([
        { role: "user", content: "hi" },
        { role: "system", content: "Retrieved context: opening hours 9 to 17" },
        { role: "assistant", content: "hello!" },
      ]);
    });
  });

  describe("when the lifted turn uses the developer spelling", () => {
    it("removes it like a system turn", () => {
      const stripped = stripLiftedSystemMessage([
        { role: "developer", content: "You are OpenCode." },
        { role: "user", content: "hi" },
      ]);
      expect(stripped).toEqual([{ role: "user", content: "hi" }]);
    });
  });
});
