import { describe, expect, it } from "vitest";
import { formatPreview } from "../previewFormatter";

const opts = { maxChars: 80 };

describe("formatPreview", () => {
  describe("given empty input", () => {
    it("returns empty text without parsing", () => {
      expect(formatPreview(null, opts)).toEqual({ text: "" });
      expect(formatPreview(undefined, opts)).toEqual({ text: "" });
      expect(formatPreview("", opts)).toEqual({ text: "" });
    });
  });

  describe("given plain prose", () => {
    it("returns the input unchanged when within the cap", () => {
      const result = formatPreview("Hello, how are you?", opts);
      expect(result.text).toBe("Hello, how are you?");
      expect(result.role).toBeUndefined();
    });

    it("hard-caps at maxChars with an ellipsis", () => {
      const long = "a".repeat(200);
      const result = formatPreview(long, { maxChars: 20 });
      expect(result.text).toBe(`${"a".repeat(19)}…`);
    });
  });

  describe("given multiline prose", () => {
    describe("when newlines: glyph", () => {
      it("renders ↵ between non-empty lines", () => {
        const result = formatPreview("line one\nline two\nline three", {
          maxChars: 80,
        });
        expect(result.text).toBe("line one ↵ line two ↵ line three");
      });

      it("collapses runs of blank lines to a single ↵", () => {
        const result = formatPreview("first\n\n\nsecond", { maxChars: 80 });
        expect(result.text).toBe("first ↵ second");
      });
    });

    describe("when newlines: space", () => {
      it("collapses all whitespace runs to single spaces", () => {
        const result = formatPreview("line one\nline two", {
          maxChars: 80,
          newlines: "space",
        });
        expect(result.text).toBe("line one line two");
      });
    });

    describe("when newlines: preserve", () => {
      it("keeps newlines verbatim", () => {
        const result = formatPreview("line one\nline two", {
          maxChars: 80,
          newlines: "preserve",
        });
        expect(result.text).toBe("line one\nline two");
      });
    });
  });

  describe("given a fenced code block", () => {
    it("strips the fence and language hint, flags hadCode", () => {
      const input = "```python\nimport time\nfrom typing import Callable\n```";
      const result = formatPreview(input, { maxChars: 80 });
      expect(result.hadCode).toBe(true);
      expect(result.text).toBe("import time ↵ from typing import Callable");
    });

    it("keeps the body when no language is specified", () => {
      const input = "```\nfoo\nbar\n```";
      const result = formatPreview(input, { maxChars: 80 });
      expect(result.hadCode).toBe(true);
      expect(result.text).toBe("foo ↵ bar");
    });

    it("does not strip inline backticks (only fenced blocks)", () => {
      const result = formatPreview("Use `foo()` to call it", { maxChars: 80 });
      expect(result.hadCode).toBe(false);
      expect(result.text).toBe("Use `foo()` to call it");
    });
  });

  describe("given markdown images", () => {
    it("replaces ![alt](url) with 📷 alt and flags hadImage", () => {
      const result = formatPreview("Look ![diagram](https://x.test/d.png) here", {
        maxChars: 80,
      });
      expect(result.hadImage).toBe(true);
      expect(result.text).toBe("Look 📷 diagram here");
    });

    it("uses bare 📷 when alt is empty", () => {
      const result = formatPreview("![](https://x.test/d.png)", { maxChars: 80 });
      expect(result.hadImage).toBe(true);
      expect(result.text).toBe("📷");
    });
  });

  describe("given a single-key JSON envelope", () => {
    it("unwraps allowlisted keys (question, input, prompt, query, text, content, message)", () => {
      for (const key of [
        "question",
        "input",
        "prompt",
        "query",
        "text",
        "content",
        "message",
      ]) {
        const result = formatPreview(`{"${key}": "hello"}`, { maxChars: 80 });
        expect(result.text).toBe("hello");
      }
    });

    it("preserves the JSON shape when the key is not allowlisted", () => {
      const result = formatPreview('{"id": "abc-123"}', { maxChars: 80 });
      expect(result.text).toBe('{"id":"abc-123"}');
    });

    it("preserves multi-key objects", () => {
      const result = formatPreview('{"a": 1, "b": 2}', { maxChars: 80 });
      expect(result.text).toBe('{"a":1,"b":2}');
    });

    it("renders an image inside an unwrapped envelope as 📷", () => {
      const result = formatPreview('{"question": "![](https://x/y.jpeg)"}', {
        maxChars: 80,
      });
      expect(result.text).toBe("📷");
      expect(result.hadImage).toBe(true);
    });
  });

  describe("given a chat-shaped JSON array", () => {
    it("returns the last assistant text and surfaces role", () => {
      const input = JSON.stringify([
        { role: "user", content: "What's up?" },
        { role: "assistant", content: "All good, thanks!" },
      ]);
      const result = formatPreview(input, { maxChars: 80 });
      expect(result.text).toBe("All good, thanks!");
      expect(result.role).toBe("assistant");
    });

    it("renders tool calls as toolName(...)", () => {
      const input = JSON.stringify([
        {
          role: "assistant",
          content: "",
          tool_calls: [{ function: { name: "search_documents" } }],
        },
      ]);
      const result = formatPreview(input, { maxChars: 80 });
      expect(result.text).toBe("search_documents(...)");
      expect(result.role).toBe("assistant");
    });

    it("walks an array-shaped Anthropic content payload", () => {
      const input = JSON.stringify([
        {
          role: "assistant",
          content: [
            { type: "text", text: "Here is the answer" },
            { type: "tool_use", name: "search" },
          ],
        },
      ]);
      const result = formatPreview(input, { maxChars: 80 });
      expect(result.text).toBe("Here is the answer");
    });
  });

  describe("given a top-level Anthropic typed block", () => {
    it("unwraps {type: text, text: ...}", () => {
      const result = formatPreview('{"type":"text","text":"hello there"}', {
        maxChars: 80,
      });
      expect(result.text).toBe("hello there");
    });

    it("renders <type> for non-text blocks so the user sees something existed", () => {
      const result = formatPreview('{"type":"tool_use","name":"search"}', {
        maxChars: 80,
      });
      expect(result.text).toBe("<tool_use>");
    });
  });

  describe("given malformed JSON", () => {
    it("falls back to raw input", () => {
      const result = formatPreview('{"unclosed: "value"', { maxChars: 80 });
      expect(result.text).toBe('{"unclosed: "value"');
    });
  });

  describe("given content that combines several issues", () => {
    it("unwraps an envelope, strips a fence, surfaces glyph and hadCode", () => {
      const input = JSON.stringify({
        question: "```python\nimport time\nimport os\n```",
      });
      const result = formatPreview(input, { maxChars: 80 });
      expect(result.text).toBe("import time ↵ import os");
      expect(result.hadCode).toBe(true);
    });
  });

  describe("given stripMarkdownNoise: false", () => {
    it("leaves fences and images intact", () => {
      const result = formatPreview("```python\nfoo\n```", {
        maxChars: 80,
        stripMarkdownNoise: false,
        newlines: "preserve",
      });
      expect(result.text).toBe("```python\nfoo\n```");
      expect(result.hadCode).toBe(false);
    });
  });
});
