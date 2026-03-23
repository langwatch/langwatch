import { describe, it, expect } from "vitest";
import {
  extractMessageContentText,
  extractLastUserMessageText,
} from "../_messages";

describe("extractMessageContentText", () => {
  describe("when content is a string", () => {
    it("returns the string directly", () => {
      expect(extractMessageContentText({ role: "user", content: "hello" })).toBe(
        "hello",
      );
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
    it("extracts text from {\"0\": {\"text\": \"...\"}} format", () => {
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
      const messages = [
        { role: "user", content: { "0": { text: "🐤" } } },
      ];
      expect(extractLastUserMessageText(messages)).toBe("🐤");
    });
  });
});
