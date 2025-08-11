import { describe, expect, it } from "vitest";
import {
  INPUT_OUTPUT_TYPES,
  type InputOutputType,
  isValidInputOutputType,
  processSpanInputOutput,
  type SpanInputOutputMethod,
} from "../input-output";
import { type SpanInputOutput, type ChatMessage } from "../../../internal/generated/types/tracer";

describe("INPUT_OUTPUT_TYPES", () => {
  it("should include all expected types", () => {
    const expectedTypes = [
      "text",
      "raw",
      "chat_messages",
      "list",
      "json",
      "guardrail_result",
      "evaluation_result"
    ];

    expect(INPUT_OUTPUT_TYPES).toEqual(expectedTypes);
  });

  it("should be a readonly array", () => {
    const types: readonly string[] = INPUT_OUTPUT_TYPES;
    expect(types).toBe(INPUT_OUTPUT_TYPES);
  });

  it("should have correct length", () => {
    expect(INPUT_OUTPUT_TYPES).toHaveLength(7);
  });
});

describe("InputOutputType", () => {
  it("should accept valid input/output types", () => {
    const validTypes: InputOutputType[] = [
      "text",
      "raw",
      "chat_messages",
      "list",
      "json",
      "guardrail_result",
      "evaluation_result"
    ];

    validTypes.forEach(type => {
      expect(INPUT_OUTPUT_TYPES).toContain(type);
    });
  });
});

describe("isValidInputOutputType", () => {
  it("should return true for valid types", () => {
    INPUT_OUTPUT_TYPES.forEach(type => {
      expect(isValidInputOutputType(type)).toBe(true);
    });
  });

  it("should return false for invalid types", () => {
    const invalidTypes = [
      "invalid",
      "TEXT", // case sensitive
      "Chat_Messages", // case sensitive
      "",
      " text", // with space
      "text ", // with space
      "123",
      null,
      undefined
    ];

    invalidTypes.forEach(type => {
      expect(isValidInputOutputType(type as any)).toBe(false);
    });
  });

  it("should handle edge cases", () => {
    expect(isValidInputOutputType("unknown_type")).toBe(false);
    expect(isValidInputOutputType("text_extended")).toBe(false);
    expect(isValidInputOutputType("json_data")).toBe(false);
  });
});

describe("processSpanInputOutput", () => {
  describe("explicit type scenarios", () => {
    it("should process text type correctly", () => {
      const result = processSpanInputOutput("text", "Hello world");

      expect(result).toEqual({
        type: "text",
        value: "Hello world"
      });
    });

    it("should process raw type correctly", () => {
      const result = processSpanInputOutput("raw", "Raw content");

      expect(result).toEqual({
        type: "raw",
        value: "Raw content"
      });
    });

    it("should process chat_messages type correctly", () => {
      const messages: ChatMessage[] = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there!" }
      ];

      const result = processSpanInputOutput("chat_messages", messages);

      expect(result.type).toBe("chat_messages");
      expect(Array.isArray(result.value)).toBe(true);
    });

    it("should process list type correctly", () => {
      const list: SpanInputOutput[] = [
        { type: "text", value: "Item 1" },
        { type: "text", value: "Item 2" }
      ];

      const result = processSpanInputOutput("list", list);

      expect(result.type).toBe("list");
      expect(Array.isArray(result.value)).toBe(true);
    });

    it("should process json type correctly", () => {
      const jsonData = { key: "value", number: 42, nested: { array: [1, 2, 3] } };

      const result = processSpanInputOutput("json", jsonData);

      expect(result).toEqual({
        type: "json",
        value: jsonData
      });
    });

    it("should handle invalid type gracefully", () => {
      const result = processSpanInputOutput("invalid_type", "test");

      expect(result.type).toBe("json");
    });

    it("should convert non-string to string for text type", () => {
      const result = processSpanInputOutput("text", 123);

      expect(result).toEqual({
        type: "text",
        value: "123"
      });
    });

    it("should handle non-array for chat_messages", () => {
      const result = processSpanInputOutput("chat_messages", "not an array");

      expect(result.type).toBe("chat_messages");
      expect(Array.isArray(result.value)).toBe(true);
    });

    it("should handle invalid JSON gracefully", () => {
      const circularObj: any = {};
      circularObj.self = circularObj;

      const result = processSpanInputOutput("json", circularObj);

      expect(result.type).toBe("json");
      // The function should handle circular references gracefully
      expect(result.value).toBeDefined();
    });

    it("should prefer explicit type over auto-detection", () => {
      // This object would normally auto-detect as "json", but explicit "text" should be preferred
      const obj = { key: "value" };
      const result = processSpanInputOutput("text", obj);

      expect(result.type).toBe("text");
      expect(typeof result.value).toBe("string");
    });

    it("should prefer explicit json type for string input", () => {
      // This string would normally auto-detect as "text", but explicit "json" should be preferred
      const result = processSpanInputOutput("json", "Hello world");

      expect(result.type).toBe("json");
      expect(result.value).toBe("Hello world");
    });

    it("should prefer explicit raw type for complex object", () => {
      const complexObj = { nested: { data: [1, 2, 3] } };
      const result = processSpanInputOutput("raw", complexObj);

      expect(result.type).toBe("raw");
      expect(result.value).toBe("[object]"); // Objects are converted to string representation even for raw type
    });
  });

  describe("auto-detection scenarios", () => {
    it("should auto-detect string as text", () => {
      const result = processSpanInputOutput("Hello world");

      expect(result).toEqual({
        type: "text",
        value: "Hello world"
      });
    });

    it("should auto-detect null/undefined as json", () => {
      const nullResult = processSpanInputOutput(null);
      const undefinedResult = processSpanInputOutput(undefined);

      expect(nullResult).toEqual({
        type: "json",
        value: null
      });

      expect(undefinedResult).toEqual({
        type: "json",
        value: null
      });
    });

    it("should auto-detect single chat message", () => {
      const message: ChatMessage = { role: "user", content: "Hello" };
      const result = processSpanInputOutput(message);

      expect(result).toEqual({
        type: "chat_messages",
        value: [message]
      });
    });

    it("should auto-detect chat message array", () => {
      const messages: ChatMessage[] = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi!" }
      ];

      const result = processSpanInputOutput(messages);

      expect(result).toEqual({
        type: "chat_messages",
        value: messages
      });
    });

    it("should auto-detect mixed array as list", () => {
      const mixedArray = ["text", 123, { key: "value" }];
      const result = processSpanInputOutput(mixedArray);

      expect(result.type).toBe("list");
      expect(Array.isArray(result.value)).toBe(true);
    });

    it("should auto-detect object as json", () => {
      const obj = {
        string: "test",
        number: 42,
        boolean: true,
        nested: { array: [1, 2, 3] }
      };

      const result = processSpanInputOutput(obj);

      expect(result).toEqual({
        type: "json",
        value: obj
      });
    });

    it("should handle primitives", () => {
      const numberResult = processSpanInputOutput(42);
      const booleanResult = processSpanInputOutput(true);

      expect(numberResult.type).toBe("text");
      expect(numberResult.value).toBe("42");

      expect(booleanResult.type).toBe("text");
      expect(booleanResult.value).toBe("true");
    });

    it("should handle empty array", () => {
      const result = processSpanInputOutput([]);

      expect(result).toEqual({
        type: "list",
        value: []
      });
    });

    it("should handle empty object", () => {
      const result = processSpanInputOutput({});

      expect(result).toEqual({
        type: "json",
        value: {}
      });
    });

    it("should handle complex nested structures", () => {
      const complex = {
        users: [
          { id: 1, messages: [{ role: "user", content: "Hello" }] },
          { id: 2, messages: [{ role: "assistant", content: "Hi" }] }
        ],
        metadata: {
          count: 2,
          tags: ["chat", "test"],
          config: null
        }
      };

      const result = processSpanInputOutput(complex);

      expect(result.type).toBe("json");
      expect(result.value).toEqual(complex);
    });
  });

  describe("edge cases and error handling", () => {
    it("should handle functions gracefully", () => {
      const fn = () => "test";
      const result = processSpanInputOutput(fn);

      // Functions can't be JSON serialized, so they should fall back to string representation
      expect(result.type).toBe("text");
      expect(typeof result.value).toBe("string");
    });

    it("should handle symbols gracefully", () => {
      const sym = Symbol("test");
      const result = processSpanInputOutput(sym);

      // Symbols can't be JSON serialized, so they should fall back to string representation
      expect(result.type).toBe("text");
      expect(typeof result.value).toBe("string");
    });

    it("should handle dates", () => {
      const date = new Date("2024-01-01");
      const result = processSpanInputOutput(date);

      // Even though dates are JSON serializable, the implementation falls back to text
      expect(result.type).toBe("text");
      expect(typeof result.value).toBe("string");
    });

    it("should handle regular expressions", () => {
      const regex = /test/g;
      const result = processSpanInputOutput(regex);

      // Regex objects can't be JSON serialized, so they fall back to text
      expect(result.type).toBe("text");
      expect(typeof result.value).toBe("string");
    });

    it("should handle bigint gracefully", () => {
      const bigIntValue = BigInt(123);
      const result = processSpanInputOutput(bigIntValue);

      // BigInt can't be JSON serialized, so it should fall back to string representation
      expect(result.type).toBe("text");
      expect(typeof result.value).toBe("string");
    });

    it("should handle malformed chat messages", () => {
      const malformedMessages = [
        { role: "user" }, // missing content
        { content: "Hello" }, // missing role
        { role: "invalid", content: "test" } // invalid role
      ];

      const result = processSpanInputOutput("chat_messages", malformedMessages);

      expect(result.type).toBe("chat_messages");
      expect(Array.isArray(result.value)).toBe(true);
    });
  });

  describe("validation fallbacks", () => {
    it("should handle extreme edge cases gracefully", () => {
      // Test with undefined values
      const result1 = processSpanInputOutput("text", undefined);
      expect(result1.type).toBe("text");

      // Test with very complex objects
      const complexObj = {
        nested: {
          deep: {
            array: [1, 2, { more: "nesting" }],
            func: () => "test"
          }
        }
      };
      const result2 = processSpanInputOutput(complexObj);
      expect(result2.type).toBe("json");
    });

    it("should handle objects with safe fallback", () => {
      // Test objects that can't be JSON serialized
      const objWithCircularRef: any = { name: "test" };
      objWithCircularRef.self = objWithCircularRef;

      const result = processSpanInputOutput(objWithCircularRef);
      expect(result.type).toBe("json");
      expect(result.value).toBeDefined();
    });

    it("should handle non-serializable objects gracefully", () => {
      // Test with objects that have non-serializable properties
      const objWithFunction = {
        data: "test",
        method: () => "hello"
      };

      const result = processSpanInputOutput(objWithFunction);
      expect(result.type).toBe("json");
      expect(result.value).toBeDefined();
    });

    it("should provide meaningful fallback for objects in text mode", () => {
      const obj = { key: "value" };
      const result = processSpanInputOutput("text", obj);

      expect(result.type).toBe("text");
      expect(typeof result.value).toBe("string");
      expect(result.value).toBe("[object]"); // Objects are converted to '[object]' string representation
    });
  });
});

describe("SpanInputOutputMethod type", () => {
  it("should define correct method signatures", () => {
    // This test verifies that the type definition is correct
    // by creating a mock function that implements the interface
    const mockMethod: SpanInputOutputMethod<void> = (
      typeOrValue: any,
      value?: any
    ) => {
      // Mock implementation
      if (typeof typeOrValue === "string" && value !== undefined) {
        // Explicit type case
        return;
      } else {
        // Auto-detect case
        return;
      }
    };

    // Test that all signatures are callable
    expect(() => {
      mockMethod("text", "hello");
      mockMethod("raw", "data");
      mockMethod("chat_messages", []);
      mockMethod("list", []);
      mockMethod("json", {});
      mockMethod({ auto: "detect" });
    }).not.toThrow();
  });
});

describe("integration scenarios", () => {
  it("should handle realistic LLM input/output", () => {
    const input = processSpanInputOutput("chat_messages", [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "What is the capital of France?" }
    ]);

    const output = processSpanInputOutput("chat_messages", [
      { role: "assistant", content: "The capital of France is Paris." }
    ]);

    expect(input.type).toBe("chat_messages");
    expect(output.type).toBe("chat_messages");
    expect(Array.isArray(input.value)).toBe(true);
    expect(Array.isArray(output.value)).toBe(true);
  });

  it("should handle tool call scenarios", () => {
    const toolInput = processSpanInputOutput("json", {
      function: "get_weather",
      arguments: { location: "Paris", unit: "celsius" }
    });

    const toolOutput = processSpanInputOutput("json", {
      temperature: 22,
      condition: "sunny",
      humidity: 45
    });

    expect(toolInput.type).toBe("json");
    expect(toolOutput.type).toBe("json");
  });

  it("should handle RAG context scenarios", () => {
    const contexts = [
      "Paris is the capital and most populous city of France.",
      "Paris is located in northern central France, in a north-bending arc of the river Seine.",
      "The city proper has an area of 105 square kilometres."
    ];

    const result = processSpanInputOutput("list", contexts.map(context =>
      processSpanInputOutput("text", context)
    ));

    expect(result.type).toBe("list");
    expect(Array.isArray(result.value)).toBe(true);
  });

  it("should handle streaming scenarios", () => {
    const chunks = [
      "The",
      " capital",
      " of",
      " France",
      " is",
      " Paris."
    ];

    const result = processSpanInputOutput("list", chunks.map(chunk =>
      processSpanInputOutput("text", chunk)
    ));

    expect(result.type).toBe("list");
    expect(Array.isArray(result.value)).toBe(true);
    expect(result.value).toHaveLength(6);
  });

  it("should handle auto-detection in real scenarios", () => {
    // Auto-detect string
    const stringResult = processSpanInputOutput("Simple string input");
    expect(stringResult.type).toBe("text");
    expect(stringResult.value).toBe("Simple string input");

    // Auto-detect chat messages
    const chatResult = processSpanInputOutput([
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there!" }
    ]);
    expect(chatResult.type).toBe("chat_messages");
    expect(Array.isArray(chatResult.value)).toBe(true);

    // Auto-detect complex object
    const objectResult = processSpanInputOutput({
      timestamp: "2024-01-01T00:00:00Z",
      data: { user_id: 123, action: "login" },
      metadata: { source: "web", version: "1.0" }
    });
    expect(objectResult.type).toBe("json");
    expect(typeof objectResult.value).toBe("object");
  });
});
