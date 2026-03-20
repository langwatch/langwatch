import { describe, expect, it } from "vitest";
import { serializeValueForDataset } from "../tracesMapping";

describe("serializeValueForDataset", () => {
  describe("when given a plain object (not ChatMessage)", () => {
    it("falls through to JSON.stringify", () => {
      const obj = { foo: "bar", count: 42 };
      expect(serializeValueForDataset(obj)).toBe(JSON.stringify(obj));
    });
  });

  describe("when given a ChatMessage array with string content", () => {
    it("extracts text content joined by newline", () => {
      const messages = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there" },
      ];
      expect(serializeValueForDataset(messages)).toBe("Hello\nHi there");
    });
  });

  describe("when given a ChatMessage array with array-of-parts content", () => {
    it("extracts only text parts", () => {
      const messages = [
        {
          role: "user",
          content: [
            { type: "text", text: "What is this?" },
            { type: "image_url", image_url: { url: "http://example.com/img.png" } },
          ],
        },
      ];
      expect(serializeValueForDataset(messages)).toBe("What is this?");
    });
  });

  describe("when given a ChatMessage array with only tool_calls and no text", () => {
    it("falls back to JSON.stringify", () => {
      const messages = [
        {
          role: "assistant",
          content: null,
          tool_calls: [{ id: "tc_1", function: { name: "search", arguments: "{}" } }],
        },
      ];
      // content is null, so no text extracted -> falls back to JSON.stringify
      expect(serializeValueForDataset(messages)).toBe(JSON.stringify(messages));
    });
  });

  describe("when given an empty array", () => {
    it("falls through to JSON.stringify", () => {
      expect(serializeValueForDataset([])).toBe(JSON.stringify([]));
    });
  });

  describe("when given an array of non-ChatMessage objects", () => {
    it("falls through to JSON.stringify", () => {
      const items = [
        { id: 1, name: "item1" },
        { id: 2, name: "item2" },
      ];
      expect(serializeValueForDataset(items)).toBe(JSON.stringify(items));
    });
  });

  describe("when given a ChatMessage array with mixed string and parts content", () => {
    it("extracts all text from both formats", () => {
      const messages = [
        { role: "user", content: "Plain text message" },
        {
          role: "assistant",
          content: [
            { type: "text", text: "First part" },
            { type: "text", text: "Second part" },
          ],
        },
      ];
      expect(serializeValueForDataset(messages)).toBe(
        "Plain text message\nFirst part\nSecond part",
      );
    });
  });
});
