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

  describe("given prepended XML context above the human text", () => {
    /** @scenario "The trace list preview shows the human text, not the boilerplate" */
    it("strips a leading system-reminder block from a plain string", () => {
      const input =
        "<system-reminder>\nThe following skills are available\n</system-reminder>\n\nhi";
      const result = formatPreview(input, opts);
      expect(result.text).toBe("hi");
    });

    it("strips the leading context inside a chat-array user message", () => {
      const input = JSON.stringify([
        {
          role: "user",
          content:
            "<system-reminder>big boilerplate</system-reminder>\n\nwhat is 2+2?",
        },
      ]);
      const result = formatPreview(input, opts);
      expect(result.text).toBe("what is 2+2?");
      expect(result.role).toBe("user");
    });

    /** @scenario "A context-only message stays visible instead of blanking" */
    it("keeps a context-only message visible rather than blanking it", () => {
      const input = "<system-reminder>only context, no human text</system-reminder>";
      const result = formatPreview(input, opts);
      expect(result.text).toContain("only context");
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
      it("renders ↵ between non-empty lines", () => {
        const result = formatPreview("line one\nline two\nline three", {
          maxChars: 80,
        });
        expect(result.text).toBe("line one ↵ line two ↵ line three");
      });

      it("collapses runs of blank lines to a single ↵", () => {
        const result = formatPreview("first\n\n\nsecond", { maxChars: 80 });
        expect(result.text).toBe("first ↵ second");
      });

      it("glues the ↵ to the preceding word with a non-breaking space", () => {
        // Without an NBSP before the glyph, CSS word-wrap could break
        // between the word and the glyph — and the wrapped line would
        // then *start* with ↵, which read as "this line begins with a
        // newline marker" rather than "the previous line ended here."
        // Regression for the 2026-05-20 customer report.
        const result = formatPreview("alpha\nbeta", { maxChars: 80 });
        const NBSP = " ";
        expect(result.text).toBe(`alpha${NBSP}↵ beta`);
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
      expect(result.text).toBe("import time ↵ from typing import Callable");
    });

    it("keeps the body when no language is specified", () => {
      const input = "```\nfoo\nbar\n```";
      const result = formatPreview(input, { maxChars: 80 });
      expect(result.hadCode).toBe(true);
      expect(result.text).toBe("foo ↵ bar");
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

    // Regression for the 2026-05-14 prod report: the new traces explorer
    // was rendering message-shaped traces (Genkit / AI SDK / Mastra) as
    // raw JSON because unwrapChatArray only knew the `content` field.
    // Backend's extractMessageContentText already handles `parts`; the
    // renderer was the lone gap.
    it("walks Genkit/Mastra-style `parts` arrays with {type:text, content:...}", () => {
      const input = JSON.stringify([
        {
          role: "assistant",
          parts: [
            { type: "text", content: "I can see this is a G'nger Refresh Juice" },
          ],
        },
      ]);
      const result = formatPreview(input, { maxChars: 80 });
      expect(result.text).toBe("I can see this is a G'nger Refresh Juice");
      expect(result.role).toBe("assistant");
    });

    it("skips non-text parts (blob, image, reasoning) and surfaces only text parts", () => {
      // Real prod payload shape: user uploads a product image (blob)
      // plus a structured text description. Preview must show the text.
      const input = JSON.stringify([
        {
          role: "user",
          parts: [
            {
              type: "blob",
              modality: "image",
              mime_type: "image/png",
              content: "iVBORw0KGgo...",
            },
            { type: "text", content: "Product: G'nger Refresh juice 200 ml" },
          ],
        },
      ]);
      const result = formatPreview(input, { maxChars: 200 });
      expect(result.text).toBe("Product: G'nger Refresh juice 200 ml");
      expect(result.role).toBe("user");
    });

    it("joins multiple text parts with a space", () => {
      const input = JSON.stringify([
        {
          role: "assistant",
          parts: [
            { type: "text", content: "First part." },
            { type: "text", content: "Second part." },
          ],
        },
      ]);
      const result = formatPreview(input, { maxChars: 200 });
      expect(result.text).toBe("First part. Second part.");
    });

    it("accepts Anthropic-shaped parts with {type:text, text:...}", () => {
      const input = JSON.stringify([
        {
          role: "assistant",
          parts: [{ type: "text", text: "Hello via parts.text" }],
        },
      ]);
      const result = formatPreview(input, { maxChars: 80 });
      expect(result.text).toBe("Hello via parts.text");
    });

    it("accepts AI SDK v5 `reasoning` parts as renderable text", () => {
      // v5 splits chain-of-thought into its own part; the visible text
      // still lives in `.text`. Treating it as renderable keeps the
      // preview useful rather than falling through to JSON wrapper.
      const input = JSON.stringify([
        {
          role: "assistant",
          parts: [
            { type: "reasoning", text: "Thinking about the answer…" },
            { type: "text", text: "Final answer." },
          ],
        },
      ]);
      const result = formatPreview(input, { maxChars: 200 });
      expect(result.text).toBe("Thinking about the answer… Final answer.");
    });

    it("falls through to JSON when parts has no text-typed entries", () => {
      // Image-only message: no text to extract. Preview falls through
      // to the wrapper JSON rather than fabricating "(blob)" — caller
      // can show the raw shape if needed.
      const input = JSON.stringify([
        {
          role: "user",
          parts: [{ type: "blob", modality: "image", mime_type: "image/png" }],
        },
      ]);
      const result = formatPreview(input, { maxChars: 200 });
      expect(result.text).toContain("blob");
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
      expect(result.text).toBe("import time ↵ import os");
      expect(result.hadCode).toBe(true);
    });
  });

  describe("given a Python-repr payload (single quotes)", () => {
    it("unwraps a repr content-part array into text plus media glyphs", () => {
      const input =
        "[{'type': 'text', 'text': '[shouting] you charged me twice'}, {'type': 'input_audio', 'input_audio': 'UklGRiS'}]";
      const result = formatPreview(input, { maxChars: 200 });
      expect(result.text).toBe(
        "[shouting] you charged me twice \u{1F399}️",
      );
    });

    it("unwraps a repr chat array with None/True literals", () => {
      const input =
        "[{'role': 'user', 'content': 'hello there', 'name': None, 'cached': True}]";
      const result = formatPreview(input, { maxChars: 80 });
      expect(result.text).toBe("hello there");
      expect(result.role).toBe("user");
    });

    it("keeps escaped apostrophes inside repr strings", () => {
      const input = "[{'type': 'text', 'text': 'it\\'s fine'}]";
      const result = formatPreview(input, { maxChars: 80 });
      expect(result.text).toBe("it's fine");
    });
  });

  describe("given a JSON content-part array without roles", () => {
    it("joins text parts and shows a glyph per non-text part", () => {
      const input = JSON.stringify([
        { type: "text", text: "describe this" },
        { type: "image_url", image_url: { url: "data:image/png;base64,xyz" } },
      ]);
      const result = formatPreview(input, { maxChars: 80 });
      expect(result.text).toBe("describe this \u{1F4F7}");
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
