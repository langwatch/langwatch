import { describe, expect, it } from "vitest";
import { canonicalisation, makeStubSpan } from "./test-helpers";

const stubSpan = makeStubSpan();

describe("TraceCanonicalisationService: structured IO", () => {
  describe("when the AI SDK emits a flat structured response", () => {
    it("lifts ai.response.object into canonical output messages for embedded scopes", () => {
      const objectPayload = { greeting: "Hallo" };
      const result = canonicalisation.canonicalizeSpanAttributes({
        spanAttributes: {
          "ai.response.object": JSON.stringify(objectPayload),
        },
        events: [],
        span: makeStubSpan({
          name: "ai.generateText",
          instrumentationScope: { name: "opencode", version: null },
        }),
      });

      expect(result.attributes["langwatch.span.type"]).toBe("llm");
      expect(result.attributes["gen_ai.output.messages"]).toEqual([
        { role: "assistant", content: JSON.stringify(objectPayload) },
      ]);
    });
  });

  describe("when input type is chat_messages", () => {
    it("sets gen_ai.input.messages from value array (stripping trailing assistant — post-call capture leak)", () => {
      const result = canonicalisation.canonicalizeSpanAttributes({
        spanAttributes: {
          "langwatch.input": JSON.stringify({
            type: "chat_messages",
            value: [
              { role: "user", content: "Hello" },
              { role: "assistant", content: "Hi there" },
            ],
          }),
        },
        events: [],
        span: stubSpan,
      });

      // Trailing assistant messages are stripped — they are the model's
      // response leaking back into input from post-call attribute capture,
      // not part of what was actually sent to the model.
      expect(result.attributes["gen_ai.input.messages"]).toEqual([
        { role: "user", content: "Hello" },
      ]);
    });

    it("preserves prior assistant messages in multi-turn conversations", () => {
      const result = canonicalisation.canonicalizeSpanAttributes({
        spanAttributes: {
          "langwatch.input": JSON.stringify({
            type: "chat_messages",
            value: [
              { role: "user", content: "Hi" },
              { role: "assistant", content: "Hello!" },
              { role: "user", content: "How are you?" },
            ],
          }),
        },
        events: [],
        span: stubSpan,
      });

      // Last message is `user` — full multi-turn history kept intact.
      expect(result.attributes["gen_ai.input.messages"]).toEqual([
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Hello!" },
        { role: "user", content: "How are you?" },
      ]);
    });

    it("does not override span type to llm", () => {
      const result = canonicalisation.canonicalizeSpanAttributes({
        spanAttributes: {
          "langwatch.span.type": "agent",
          "langwatch.input": JSON.stringify({
            type: "chat_messages",
            value: [{ role: "user", content: "Hello" }],
          }),
        },
        events: [],
        span: stubSpan,
      });

      expect(result.attributes["langwatch.span.type"]).toBe("agent");
    });

    it("extracts system instruction from first system message", () => {
      const result = canonicalisation.canonicalizeSpanAttributes({
        spanAttributes: {
          "langwatch.input": JSON.stringify({
            type: "chat_messages",
            value: [
              { role: "system", content: "You are helpful." },
              { role: "user", content: "Hi" },
            ],
          }),
        },
        events: [],
        span: stubSpan,
      });

      expect(result.attributes["gen_ai.system_instructions"]).toBe("You are helpful.");
    });

    it("preserves original wrapper in langwatch.input", () => {
      const wrapper = JSON.stringify({
        type: "chat_messages",
        value: [{ role: "user", content: "Hello" }],
      });
      const result = canonicalisation.canonicalizeSpanAttributes({
        spanAttributes: { "langwatch.input": wrapper },
        events: [],
        span: stubSpan,
      });

      // The wrapper object is re-set back to langwatch.input
      expect(result.attributes["langwatch.input"]).toEqual({
        type: "chat_messages",
        value: [{ role: "user", content: "Hello" }],
      });
    });

    it("records input type in langwatch.reserved.value_types", () => {
      const result = canonicalisation.canonicalizeSpanAttributes({
        spanAttributes: {
          "langwatch.input": JSON.stringify({
            type: "chat_messages",
            value: [{ role: "user", content: "Hello" }],
          }),
        },
        events: [],
        span: stubSpan,
      });

      expect(result.attributes["langwatch.reserved.value_types"]).toEqual([
        "langwatch.input=chat_messages",
      ]);
    });
  });

  describe("when output type is chat_messages", () => {
    it("sets gen_ai.output.messages from value array", () => {
      const messages = [{ role: "assistant", content: "I can help" }];
      const result = canonicalisation.canonicalizeSpanAttributes({
        spanAttributes: {
          "langwatch.output": JSON.stringify({
            type: "chat_messages",
            value: messages,
          }),
        },
        events: [],
        span: stubSpan,
      });

      expect(result.attributes["gen_ai.output.messages"]).toEqual(messages);
    });

    it("keeps unwrapped messages in langwatch.output", () => {
      const messages = [{ role: "assistant", content: "I can help" }];
      const result = canonicalisation.canonicalizeSpanAttributes({
        spanAttributes: {
          "langwatch.output": JSON.stringify({
            type: "chat_messages",
            value: messages,
          }),
        },
        events: [],
        span: stubSpan,
      });

      expect(result.attributes["langwatch.output"]).toEqual(messages);
    });

    it("records output type in langwatch.reserved.value_types", () => {
      const result = canonicalisation.canonicalizeSpanAttributes({
        spanAttributes: {
          "langwatch.output": JSON.stringify({
            type: "chat_messages",
            value: [{ role: "assistant", content: "I can help" }],
          }),
        },
        events: [],
        span: stubSpan,
      });

      expect(result.attributes["langwatch.reserved.value_types"]).toEqual([
        "langwatch.output=chat_messages",
      ]);
    });
  });

  describe("when both input and output have structured types", () => {
    it("records both types in langwatch.reserved.value_types", () => {
      const result = canonicalisation.canonicalizeSpanAttributes({
        spanAttributes: {
          "langwatch.input": JSON.stringify({
            type: "text",
            value: "Hello",
          }),
          "langwatch.output": JSON.stringify({
            type: "json",
            value: ["result"],
          }),
        },
        events: [],
        span: stubSpan,
      });

      expect(result.attributes["langwatch.reserved.value_types"]).toEqual([
        "langwatch.input=text",
        "langwatch.output=json",
      ]);
    });
  });

  describe("when output type is json (DSPy)", () => {
    it("joins array items as assistant message for gen_ai.output.messages", () => {
      const result = canonicalisation.canonicalizeSpanAttributes({
        spanAttributes: {
          "langwatch.output": JSON.stringify({
            type: "json",
            value: ["answer: 42", "confidence: high"],
          }),
        },
        events: [],
        span: stubSpan,
      });

      expect(result.attributes["gen_ai.output.messages"]).toEqual([
        { role: "assistant", content: "answer: 42\nconfidence: high" },
      ]);
    });

    it("stores unwrapped value in langwatch.output", () => {
      const result = canonicalisation.canonicalizeSpanAttributes({
        spanAttributes: {
          "langwatch.output": JSON.stringify({
            type: "json",
            value: ["result"],
          }),
        },
        events: [],
        span: stubSpan,
      });

      // Unwrapped string array passes through toAttrValue as-is
      expect(result.attributes["langwatch.output"]).toEqual(["result"]);
    });
  });

  describe("when type is text", () => {
    it("unwraps value and records type in reserved types", () => {
      const result = canonicalisation.canonicalizeSpanAttributes({
        spanAttributes: {
          "langwatch.input": JSON.stringify({
            type: "text",
            value: "Hello world",
          }),
        },
        events: [],
        span: stubSpan,
      });

      // Value is unwrapped
      expect(result.attributes["langwatch.input"]).toBe("Hello world");
      // Type is recorded in reserved types
      expect(result.attributes["langwatch.reserved.value_types"]).toEqual([
        "langwatch.input=text",
      ]);
      // Should NOT produce gen_ai.input.messages for text types
      expect(result.attributes["gen_ai.input.messages"]).toBeUndefined();
    });
  });

  describe("when type is raw", () => {
    it("unwraps value and records type in reserved types", () => {
      const rawData = { some: "data" };
      const result = canonicalisation.canonicalizeSpanAttributes({
        spanAttributes: {
          "langwatch.input": JSON.stringify({
            type: "raw",
            value: rawData,
          }),
        },
        events: [],
        span: stubSpan,
      });

      // Value is unwrapped (object stored directly)
      expect(result.attributes["langwatch.input"]).toEqual(rawData);
      expect(result.attributes["langwatch.reserved.value_types"]).toEqual([
        "langwatch.input=raw",
      ]);
      expect(result.attributes["gen_ai.input.messages"]).toBeUndefined();
    });
  });

  describe("when type is list", () => {
    it("unwraps value and records type in reserved types", () => {
      const result = canonicalisation.canonicalizeSpanAttributes({
        spanAttributes: {
          "langwatch.input": JSON.stringify({
            type: "list",
            value: ["a", "b", "c"],
          }),
        },
        events: [],
        span: stubSpan,
      });

      // Value is unwrapped — string array passes through toAttrValue
      expect(result.attributes["langwatch.input"]).toEqual(["a", "b", "c"]);
      expect(result.attributes["langwatch.reserved.value_types"]).toEqual([
        "langwatch.input=list",
      ]);
      expect(result.attributes["gen_ai.input.messages"]).toBeUndefined();
    });
  });

  describe("when input is not a structured wrapper", () => {
    it("flattens single-element arrays for legacy behavior", () => {
      const result = canonicalisation.canonicalizeSpanAttributes({
        spanAttributes: {
          "langwatch.input": JSON.stringify(["only item"]),
        },
        events: [],
        span: stubSpan,
      });

      expect(result.attributes["langwatch.input"]).toBe("only item");
    });

    it("keeps multi-element arrays as-is", () => {
      const arr = ["first", "second"];
      const result = canonicalisation.canonicalizeSpanAttributes({
        spanAttributes: {
          "langwatch.input": JSON.stringify(arr),
        },
        events: [],
        span: stubSpan,
      });

      expect(result.attributes["langwatch.input"]).toEqual(arr);
    });

    it("keeps plain strings as-is", () => {
      const result = canonicalisation.canonicalizeSpanAttributes({
        spanAttributes: {
          "langwatch.input": "just a string",
        },
        events: [],
        span: stubSpan,
      });

      expect(result.attributes["langwatch.input"]).toBe("just a string");
    });

    it("keeps plain objects as-is", () => {
      const obj = { key: "value" };
      const result = canonicalisation.canonicalizeSpanAttributes({
        spanAttributes: {
          "langwatch.input": JSON.stringify(obj),
        },
        events: [],
        span: stubSpan,
      });

      expect(result.attributes["langwatch.input"]).toEqual(obj);
    });

    it("does not set langwatch.reserved.value_types for non-structured inputs", () => {
      const result = canonicalisation.canonicalizeSpanAttributes({
        spanAttributes: {
          "langwatch.input": "just a string",
        },
        events: [],
        span: stubSpan,
      });

      expect(result.attributes["langwatch.reserved.value_types"]).toBeUndefined();
    });
  });

  describe("when wrapper is malformed", () => {
    it("treats {type: 123, value: ...} as non-structured (type not string)", () => {
      const wrapper = JSON.stringify({ type: 123, value: [1, 2, 3] });
      const result = canonicalisation.canonicalizeSpanAttributes({
        spanAttributes: { "langwatch.input": wrapper },
        events: [],
        span: stubSpan,
      });

      expect(result.attributes["gen_ai.input.messages"]).toBeUndefined();
      expect(result.attributes["langwatch.input"]).toBeDefined();
    });

    it("treats {type: 'chat_messages'} missing value as non-structured", () => {
      const wrapper = JSON.stringify({ type: "chat_messages" });
      const result = canonicalisation.canonicalizeSpanAttributes({
        spanAttributes: { "langwatch.input": wrapper },
        events: [],
        span: stubSpan,
      });

      expect(result.attributes["gen_ai.input.messages"]).toBeUndefined();
      expect(result.attributes["langwatch.input"]).toBeDefined();
    });
  });
});
