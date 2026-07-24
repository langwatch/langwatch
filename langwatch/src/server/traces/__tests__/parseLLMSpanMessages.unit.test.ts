import { describe, it, expect } from "vitest";

import { parseLLMSpanMessages } from "../parseLLMSpanMessages";

describe("parseLLMSpanMessages()", () => {
  describe("when input carries the TypedValueJson chat_messages wrapper", () => {
    it("extracts every message in order", () => {
      const attrs = {
        "gen_ai.input.messages": JSON.stringify({
          type: "chat_messages",
          value: [
            { role: "system", content: "Be helpful." },
            { role: "user", content: "What is 2+2?" },
          ],
        }),
      };
      expect(parseLLMSpanMessages(attrs)).toEqual([
        { role: "system", content: "Be helpful." },
        { role: "user", content: "What is 2+2?" },
      ]);
    });
  });

  describe("when chat_messages typed-wrapper items omit role (CR consistency)", () => {
    // Pre-fix, the typed-wrapper branch trusted the ChatMessage type
    // assertion and let `{content}` items through with `role` left
    // `undefined`. The bare-array and single-object branches both
    // default missing roles to `defaultRole` — the wrapper branch now
    // matches them so the shape coming out is consistent regardless
    // of which envelope carried the payload.
    it("defaults missing role to defaultRole, matching the other branches", () => {
      const attrs = {
        "langwatch.input": JSON.stringify({
          type: "chat_messages",
          value: [
            { content: "no role here" },
            { role: "user", content: "explicit role" },
            { role: 42, content: "non-string role" },
          ],
        }),
      };
      const result = parseLLMSpanMessages(attrs);
      expect(result).toEqual([
        { role: "user", content: "no role here" },
        { role: "user", content: "explicit role" },
        { role: "user", content: "non-string role" },
      ]);
    });
  });

  describe("when input carries a bare array of message objects (nlpgo langwatch.input shape)", () => {
    it("extracts each entry with its embedded role", () => {
      const attrs = {
        "langwatch.input": JSON.stringify([
          { role: "system", content: "Be terse." },
          { role: "user", content: "thanks bro!" },
        ]),
      };
      expect(parseLLMSpanMessages(attrs)).toEqual([
        { role: "system", content: "Be terse." },
        { role: "user", content: "thanks bro!" },
      ]);
    });
  });

  describe("when output carries the single-object app.ChatMessage shape (nlpgo langwatch.output)", () => {
    // Real-world regression caught during dogfood: nlpgo's endLLMSpan
    // stamps langwatch.output as a JSON-encoded single app.ChatMessage
    // ({"role":"assistant","content":"You're welcome."}) — NOT an
    // array, NOT wrapped in {type, value}. Pre-fix, every branch in
    // extractPromptStudioDataFromClickHouse missed this shape and the
    // assistant reply was silently dropped from the playground
    // "Open in Prompts" resume even though the trace drawer's OUTPUT
    // panel rendered it inline.
    it("emits the assistant reply as a chat message", () => {
      const attrs = {
        "langwatch.output": JSON.stringify({
          role: "assistant",
          content: "You're welcome.",
        }),
      };
      expect(parseLLMSpanMessages(attrs)).toEqual([
        { role: "assistant", content: "You're welcome." },
      ]);
    });

    it("defaults the role to 'assistant' when the object omits it", () => {
      const attrs = {
        "langwatch.output": JSON.stringify({ content: "hello" }),
      };
      expect(parseLLMSpanMessages(attrs)).toEqual([
        { role: "assistant", content: "hello" },
      ]);
    });
  });

  describe("when input + output are both present (the playground LLM span shape)", () => {
    it("input comes first, output appended at the end — preserving the chat order on resume", () => {
      // Replays the exact shape rchaves's dogfood produced: nlpgo
      // serialised the request prompt as a bare array on langwatch.input
      // and the assistant reply as a single object on langwatch.output.
      const attrs = {
        "langwatch.input": JSON.stringify([
          { role: "system", content: "Welcome to the playground" },
          { role: "user", content: "how big is mars?" },
          { role: "assistant", content: "Mars is about 6,779 km..." },
          { role: "user", content: "thanks bro!" },
        ]),
        "langwatch.output": JSON.stringify({
          role: "assistant",
          content: "You're welcome.",
        }),
      };

      expect(parseLLMSpanMessages(attrs)).toEqual([
        { role: "system", content: "Welcome to the playground" },
        { role: "user", content: "how big is mars?" },
        { role: "assistant", content: "Mars is about 6,779 km..." },
        { role: "user", content: "thanks bro!" },
        { role: "assistant", content: "You're welcome." },
      ]);
    });
  });

  describe("when output carries a TypedValueJson string value", () => {
    it("unwraps the string into a single assistant turn", () => {
      const attrs = {
        "langwatch.output": JSON.stringify({
          type: "json",
          value: "Mars is small.",
        }),
      };
      expect(parseLLMSpanMessages(attrs)).toEqual([
        { role: "assistant", content: "Mars is small." },
      ]);
    });
  });

  describe("when attributes are missing", () => {
    it("returns an empty array", () => {
      expect(parseLLMSpanMessages({})).toEqual([]);
    });
  });

  describe("when input is unparseable JSON", () => {
    it("wraps the raw string as a single user message instead of throwing", () => {
      const attrs = { "langwatch.input": "not valid json {" };
      expect(parseLLMSpanMessages(attrs)).toEqual([
        { role: "user", content: "not valid json {" },
      ]);
    });
  });

  describe("when a recognized envelope produces zero entries (CR fallback guard)", () => {
    // Without the `before = out.length` guard added per the major CR
    // on parseLLMSpanMessages.ts:87, these cases silently dropped the
    // payload from the playground resume even though raw content was
    // present on the attribute. Falling back to a single raw-content
    // turn keeps something visible instead of pretending the LLM said
    // nothing — visible-but-ugly beats invisible-and-lost.

    it("falls back to raw content when chat_messages envelope has an empty value array", () => {
      const attrs = {
        "langwatch.output": JSON.stringify({
          type: "chat_messages",
          value: [],
        }),
      };
      const result = parseLLMSpanMessages(attrs);
      expect(result).toHaveLength(1);
      expect(result[0]?.role).toBe("assistant");
      expect(result[0]?.content).toBe(attrs["langwatch.output"]);
    });

    it("falls back to raw content when chat_messages envelope value has only malformed items", () => {
      const attrs = {
        "langwatch.output": JSON.stringify({
          type: "chat_messages",
          value: [{ role: "assistant" }, { wrong: "shape" }],
        }),
      };
      const result = parseLLMSpanMessages(attrs);
      expect(result).toHaveLength(1);
      expect(result[0]?.role).toBe("assistant");
      expect(result[0]?.content).toBe(attrs["langwatch.output"]);
    });

    it("falls back to raw content for a bare empty array", () => {
      const attrs = {
        "langwatch.input": JSON.stringify([]),
      };
      const result = parseLLMSpanMessages(attrs);
      expect(result).toHaveLength(1);
      expect(result[0]?.role).toBe("user");
      expect(result[0]?.content).toBe(attrs["langwatch.input"]);
    });

    it("falls back to raw content for an unrecognized object envelope", () => {
      const attrs = {
        "langwatch.output": JSON.stringify({
          custom_envelope: { something: "weird" },
        }),
      };
      const result = parseLLMSpanMessages(attrs);
      expect(result).toHaveLength(1);
      expect(result[0]?.role).toBe("assistant");
      expect(result[0]?.content).toBe(attrs["langwatch.output"]);
    });
  });

  describe("when input has gen_ai.input.messages set and gen_ai.prompt also present", () => {
    it("prefers gen_ai.input.messages (the newer-SDK key)", () => {
      const attrs = {
        "gen_ai.input.messages": JSON.stringify([
          { role: "user", content: "newer" },
        ]),
        "gen_ai.prompt": JSON.stringify([{ role: "user", content: "older" }]),
      };
      expect(parseLLMSpanMessages(attrs)).toEqual([
        { role: "user", content: "newer" },
      ]);
    });
  });
});
