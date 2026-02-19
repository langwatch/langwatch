import { describe, expect, it } from "vitest";
import type { NormalizedSpan } from "../../../../event-sourcing/pipelines/trace-processing/schemas/spans";
import { CanonicalizeSpanAttributesService } from "../canonicalizeSpanAttributesService";

const service = new CanonicalizeSpanAttributesService();

const stubSpan: Pick<
  NormalizedSpan,
  "name" | "kind" | "instrumentationScope" | "statusMessage" | "statusCode"
> = {
  name: "test",
  kind: "CLIENT",
  instrumentationScope: { name: "test", version: "1.0" },
  statusMessage: null,
  statusCode: null,
} as any;

describe("CanonicalizeSpanAttributesService — structured IO", () => {
  describe("when input type is chat_messages", () => {
    it("sets gen_ai.input.messages from value array", () => {
      const messages = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there" },
      ];
      const result = service.canonicalize(
        {
          "langwatch.input": JSON.stringify({
            type: "chat_messages",
            value: messages,
          }),
        },
        [],
        stubSpan as any,
      );

      const parsed = JSON.parse(
        result.attributes["gen_ai.input.messages"] as string,
      );
      expect(parsed).toEqual(messages);
    });

    it("upgrades span type to llm", () => {
      const result = service.canonicalize(
        {
          "langwatch.input": JSON.stringify({
            type: "chat_messages",
            value: [{ role: "user", content: "Hello" }],
          }),
        },
        [],
        stubSpan as any,
      );

      expect(result.attributes["langwatch.span.type"]).toBe("llm");
    });

    it("extracts system instruction from first system message", () => {
      const result = service.canonicalize(
        {
          "langwatch.input": JSON.stringify({
            type: "chat_messages",
            value: [
              { role: "system", content: "You are helpful." },
              { role: "user", content: "Hi" },
            ],
          }),
        },
        [],
        stubSpan as any,
      );

      expect(result.attributes["gen_ai.request.system_instruction"]).toBe(
        "You are helpful.",
      );
    });

    it("preserves original wrapper in langwatch.input", () => {
      const wrapper = JSON.stringify({
        type: "chat_messages",
        value: [{ role: "user", content: "Hello" }],
      });
      const result = service.canonicalize(
        { "langwatch.input": wrapper },
        [],
        stubSpan as any,
      );

      // The raw wrapper string is re-set back to langwatch.input
      expect(result.attributes["langwatch.input"]).toBe(wrapper);
    });

    it("records input type in langwatch.reserved.value_types", () => {
      const result = service.canonicalize(
        {
          "langwatch.input": JSON.stringify({
            type: "chat_messages",
            value: [{ role: "user", content: "Hello" }],
          }),
        },
        [],
        stubSpan as any,
      );

      expect(result.attributes["langwatch.reserved.value_types"]).toEqual([
        "langwatch.input=chat_messages",
      ]);
    });
  });

  describe("when output type is chat_messages", () => {
    it("sets gen_ai.output.messages from value array", () => {
      const messages = [{ role: "assistant", content: "I can help" }];
      const result = service.canonicalize(
        {
          "langwatch.output": JSON.stringify({
            type: "chat_messages",
            value: messages,
          }),
        },
        [],
        stubSpan as any,
      );

      const parsed = JSON.parse(
        result.attributes["gen_ai.output.messages"] as string,
      );
      expect(parsed).toEqual(messages);
    });

    it("keeps unwrapped messages in langwatch.output", () => {
      const messages = [{ role: "assistant", content: "I can help" }];
      const result = service.canonicalize(
        {
          "langwatch.output": JSON.stringify({
            type: "chat_messages",
            value: messages,
          }),
        },
        [],
        stubSpan as any,
      );

      const parsed = JSON.parse(
        result.attributes["langwatch.output"] as string,
      );
      expect(parsed).toEqual(messages);
    });

    it("records output type in langwatch.reserved.value_types", () => {
      const result = service.canonicalize(
        {
          "langwatch.output": JSON.stringify({
            type: "chat_messages",
            value: [{ role: "assistant", content: "I can help" }],
          }),
        },
        [],
        stubSpan as any,
      );

      expect(result.attributes["langwatch.reserved.value_types"]).toEqual([
        "langwatch.output=chat_messages",
      ]);
    });
  });

  describe("when both input and output have structured types", () => {
    it("records both types in langwatch.reserved.value_types", () => {
      const result = service.canonicalize(
        {
          "langwatch.input": JSON.stringify({
            type: "text",
            value: "Hello",
          }),
          "langwatch.output": JSON.stringify({
            type: "json",
            value: ["result"],
          }),
        },
        [],
        stubSpan as any,
      );

      expect(result.attributes["langwatch.reserved.value_types"]).toEqual([
        "langwatch.input=text",
        "langwatch.output=json",
      ]);
    });
  });

  describe("when output type is json (DSPy)", () => {
    it("joins array items as assistant message for gen_ai.output.messages", () => {
      const result = service.canonicalize(
        {
          "langwatch.output": JSON.stringify({
            type: "json",
            value: ["answer: 42", "confidence: high"],
          }),
        },
        [],
        stubSpan as any,
      );

      const parsed = JSON.parse(
        result.attributes["gen_ai.output.messages"] as string,
      );
      expect(parsed).toEqual([
        { role: "assistant", content: "answer: 42\nconfidence: high" },
      ]);
    });

    it("stores unwrapped value in langwatch.output", () => {
      const result = service.canonicalize(
        {
          "langwatch.output": JSON.stringify({
            type: "json",
            value: ["result"],
          }),
        },
        [],
        stubSpan as any,
      );

      // Unwrapped string array passes through toAttrValue as-is
      expect(result.attributes["langwatch.output"]).toEqual(["result"]);
    });
  });

  describe("when type is text", () => {
    it("unwraps value and records type in reserved types", () => {
      const result = service.canonicalize(
        {
          "langwatch.input": JSON.stringify({
            type: "text",
            value: "Hello world",
          }),
        },
        [],
        stubSpan as any,
      );

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
      const result = service.canonicalize(
        {
          "langwatch.input": JSON.stringify({
            type: "raw",
            value: rawData,
          }),
        },
        [],
        stubSpan as any,
      );

      // Value is unwrapped (object gets JSON.stringified by toAttrValue)
      expect(JSON.parse(result.attributes["langwatch.input"] as string)).toEqual(rawData);
      expect(result.attributes["langwatch.reserved.value_types"]).toEqual([
        "langwatch.input=raw",
      ]);
      expect(result.attributes["gen_ai.input.messages"]).toBeUndefined();
    });
  });

  describe("when type is list", () => {
    it("unwraps value and records type in reserved types", () => {
      const result = service.canonicalize(
        {
          "langwatch.input": JSON.stringify({
            type: "list",
            value: ["a", "b", "c"],
          }),
        },
        [],
        stubSpan as any,
      );

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
      const result = service.canonicalize(
        {
          "langwatch.input": JSON.stringify(["only item"]),
        },
        [],
        stubSpan as any,
      );

      expect(result.attributes["langwatch.input"]).toBe("only item");
    });

    it("keeps multi-element arrays as-is", () => {
      const arr = ["first", "second"];
      const result = service.canonicalize(
        {
          "langwatch.input": JSON.stringify(arr),
        },
        [],
        stubSpan as any,
      );

      expect(result.attributes["langwatch.input"]).toEqual(arr);
    });

    it("keeps plain strings as-is", () => {
      const result = service.canonicalize(
        {
          "langwatch.input": "just a string",
        },
        [],
        stubSpan as any,
      );

      expect(result.attributes["langwatch.input"]).toBe("just a string");
    });

    it("keeps plain objects as-is", () => {
      const obj = { key: "value" };
      const result = service.canonicalize(
        {
          "langwatch.input": JSON.stringify(obj),
        },
        [],
        stubSpan as any,
      );

      const output = result.attributes["langwatch.input"];
      expect(JSON.parse(output as string)).toEqual(obj);
    });

    it("does not set langwatch.reserved.value_types for non-structured inputs", () => {
      const result = service.canonicalize(
        {
          "langwatch.input": "just a string",
        },
        [],
        stubSpan as any,
      );

      expect(result.attributes["langwatch.reserved.value_types"]).toBeUndefined();
    });
  });

  describe("when wrapper is malformed", () => {
    it("treats {type: 123, value: ...} as non-structured (type not string)", () => {
      const wrapper = JSON.stringify({ type: 123, value: [1, 2, 3] });
      const result = service.canonicalize(
        { "langwatch.input": wrapper },
        [],
        stubSpan as any,
      );

      expect(result.attributes["gen_ai.input.messages"]).toBeUndefined();
      expect(result.attributes["langwatch.input"]).toBeDefined();
    });

    it("treats {type: 'chat_messages'} missing value as non-structured", () => {
      const wrapper = JSON.stringify({ type: "chat_messages" });
      const result = service.canonicalize(
        { "langwatch.input": wrapper },
        [],
        stubSpan as any,
      );

      expect(result.attributes["gen_ai.input.messages"]).toBeUndefined();
      expect(result.attributes["langwatch.input"]).toBeDefined();
    });
  });
});
