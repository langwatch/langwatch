import type { IEvent, ISpan } from "@opentelemetry/otlp-transformer";
import { describe, expect, it } from "vitest";
import type { DeepPartial } from "~/utils/types";
import {
  extractStrandsAgentsInputOutput,
  extractStrandsAgentsMetadata,
  isStrandsAgentsInstrumentation,
} from "./strands-agents";

describe("isStrandsAgentsInstrumentation", () => {
  it("returns true for scope.name === 'strands-agents'", () => {
    expect(isStrandsAgentsInstrumentation({ name: "strands-agents" }, {})).toBe(
      true,
    );
  });
  it("returns true for scope.attributes['gen_ai.system'] === 'strands-agents'", () => {
    expect(
      isStrandsAgentsInstrumentation(
        {
          attributes: [
            { key: "gen_ai.system", value: { stringValue: "strands-agents" } },
          ],
        },
        {},
      ),
    ).toBe(true);
  });
  it("returns true for scope.attributes['system.name'] === 'strands-agents'", () => {
    expect(
      isStrandsAgentsInstrumentation(
        {
          attributes: [
            { key: "system.name", value: { stringValue: "strands-agents" } },
          ],
        },
        {},
      ),
    ).toBe(true);
  });
  it("returns true for span.attributes['gen_ai.agent.name'] === 'Strands Agents'", () => {
    expect(
      isStrandsAgentsInstrumentation(
        {},
        {
          attributes: [
            {
              key: "gen_ai.agent.name",
              value: { stringValue: "Strands Agents" },
            },
          ],
        },
      ),
    ).toBe(true);
  });
  it("returns true for span.attributes['service.name'] === 'strands-agents'", () => {
    expect(
      isStrandsAgentsInstrumentation(
        {},
        {
          attributes: [
            { key: "service.name", value: { stringValue: "strands-agents" } },
          ],
        },
      ),
    ).toBe(true);
  });
  it("returns true for span.name.includes('Agents')", () => {
    expect(
      isStrandsAgentsInstrumentation(
        {},
        { name: "invoke_agent Strands Agents" },
      ),
    ).toBe(true);
  });
  it("returns true for scope.name === 'opentelemetry.instrumentation.strands'", () => {
    expect(
      isStrandsAgentsInstrumentation(
        { name: "opentelemetry.instrumentation.strands" },
        {},
      ),
    ).toBe(true);
  });
  it("returns false for wrong service name", () => {
    expect(
      isStrandsAgentsInstrumentation(
        {},
        {
          attributes: [
            { key: "service.name", value: { stringValue: "other-service" } },
          ],
        },
      ),
    ).toBe(false);
  });
  it("returns false for null scope and span", () => {
    expect(isStrandsAgentsInstrumentation(null as any, null as any)).toBe(
      false,
    );
  });
  it("returns false for undefined scope and span", () => {
    expect(
      isStrandsAgentsInstrumentation(undefined as any, undefined as any),
    ).toBe(false);
  });
  it("returns false when no relevant attributes present", () => {
    expect(isStrandsAgentsInstrumentation({}, {})).toBe(false);
  });
  it("returns false when service.name is not a string", () => {
    expect(
      isStrandsAgentsInstrumentation(
        {},
        { attributes: [{ key: "service.name", value: { intValue: 42 } }] },
      ),
    ).toBe(false);
  });
});

describe("isStrandsAgentsInstrumentation (extensive attribute checks)", () => {
  it("returns true for scope.name === 'strands-agents' (exact match)", () => {
    expect(isStrandsAgentsInstrumentation({ name: "strands-agents" }, {})).toBe(
      true,
    );
  });
  it("returns false for scope.name !== 'strands-agents'", () => {
    expect(isStrandsAgentsInstrumentation({ name: "other" }, {})).toBe(false);
  });

  it("returns true for scope.attributes['gen_ai.system'] === 'strands-agents'", () => {
    expect(
      isStrandsAgentsInstrumentation(
        {
          attributes: [
            { key: "gen_ai.system", value: { stringValue: "strands-agents" } },
          ],
        },
        {},
      ),
    ).toBe(true);
  });
  it("returns false for scope.attributes['gen_ai.system'] !== 'strands-agents'", () => {
    expect(
      isStrandsAgentsInstrumentation(
        {
          attributes: [
            { key: "gen_ai.system", value: { stringValue: "other" } },
          ],
        },
        {},
      ),
    ).toBe(false);
  });
  it("returns false for scope.attributes['gen_ai.system'] with wrong value type", () => {
    expect(
      isStrandsAgentsInstrumentation(
        { attributes: [{ key: "gen_ai.system", value: { intValue: 42 } }] },
        {},
      ),
    ).toBe(false);
  });

  it("returns true for scope.attributes['system.name'] === 'strands-agents'", () => {
    expect(
      isStrandsAgentsInstrumentation(
        {
          attributes: [
            { key: "system.name", value: { stringValue: "strands-agents" } },
          ],
        },
        {},
      ),
    ).toBe(true);
  });
  it("returns false for scope.attributes['system.name'] !== 'strands-agents'", () => {
    expect(
      isStrandsAgentsInstrumentation(
        {
          attributes: [{ key: "system.name", value: { stringValue: "other" } }],
        },
        {},
      ),
    ).toBe(false);
  });
  it("returns false for scope.attributes['system.name'] with wrong value type", () => {
    expect(
      isStrandsAgentsInstrumentation(
        { attributes: [{ key: "system.name", value: { intValue: 42 } }] },
        {},
      ),
    ).toBe(false);
  });

  it("returns true for span.attributes['gen_ai.agent.name'] === 'Strands Agents'", () => {
    expect(
      isStrandsAgentsInstrumentation(
        {},
        {
          attributes: [
            {
              key: "gen_ai.agent.name",
              value: { stringValue: "Strands Agents" },
            },
          ],
        },
      ),
    ).toBe(true);
  });
  it("returns false for span.attributes['gen_ai.agent.name'] !== 'Strands Agents'", () => {
    expect(
      isStrandsAgentsInstrumentation(
        {},
        {
          attributes: [
            { key: "gen_ai.agent.name", value: { stringValue: "Other Agent" } },
          ],
        },
      ),
    ).toBe(false);
  });
  it("returns false for span.attributes['gen_ai.agent.name'] with wrong value type", () => {
    expect(
      isStrandsAgentsInstrumentation(
        {},
        { attributes: [{ key: "gen_ai.agent.name", value: { intValue: 42 } }] },
      ),
    ).toBe(false);
  });

  it("returns true for span.attributes['service.name'] === 'strands-agents'", () => {
    expect(
      isStrandsAgentsInstrumentation(
        {},
        {
          attributes: [
            { key: "service.name", value: { stringValue: "strands-agents" } },
          ],
        },
      ),
    ).toBe(true);
  });
  it("returns false for span.attributes['service.name'] !== 'strands-agents'", () => {
    expect(
      isStrandsAgentsInstrumentation(
        {},
        {
          attributes: [
            { key: "service.name", value: { stringValue: "other-service" } },
          ],
        },
      ),
    ).toBe(false);
  });
  it("returns false for span.attributes['service.name'] with wrong value type", () => {
    expect(
      isStrandsAgentsInstrumentation(
        {},
        { attributes: [{ key: "service.name", value: { intValue: 42 } }] },
      ),
    ).toBe(false);
  });

  it("returns false if none of the attributes match", () => {
    expect(
      isStrandsAgentsInstrumentation(
        { name: "not-strands" },
        { attributes: [{ key: "foo", value: { stringValue: "bar" } }] },
      ),
    ).toBe(false);
  });

  it("returns false for missing attributes arrays", () => {
    expect(isStrandsAgentsInstrumentation({}, {})).toBe(false);
    expect(
      isStrandsAgentsInstrumentation(
        { attributes: undefined },
        { attributes: undefined },
      ),
    ).toBe(false);
  });

  it("returns false for null or undefined scope/span", () => {
    expect(isStrandsAgentsInstrumentation(null as any, null as any)).toBe(
      false,
    );
    expect(
      isStrandsAgentsInstrumentation(undefined as any, undefined as any),
    ).toBe(false);
  });
});

describe("extractStrandsAgentsInputOutput", () => {
  it("parses input and output from strands-agents events", () => {
    const span: DeepPartial<ISpan> = {
      events: [
        {
          name: "gen_ai.user.message",
          attributes: [
            { key: "role", value: { stringValue: "user" } },
            { key: "content", value: { stringValue: '"hello"' } },
            { key: "id", value: { stringValue: "msg-1" } },
          ],
        },
        {
          name: "gen_ai.tool.message",
          attributes: [
            { key: "role", value: { stringValue: "tool" } },
            { key: "content", value: { stringValue: '{"foo":42}' } },
            { key: "id", value: { stringValue: "tool-1" } },
          ],
        },
        {
          name: "gen_ai.choice",
          attributes: [
            { key: "message", value: { stringValue: '{"bar":99}' } },
            { key: "id", value: { stringValue: "choice-1" } },
            { key: "finish_reason", value: { stringValue: "end_turn" } },
          ],
        },
      ] as unknown as IEvent[],
    };
    const result = extractStrandsAgentsInputOutput(span);
    expect(result).toEqual({
      input: {
        type: "chat_messages",
        value: [
          {
            role: "user",
            content: "hello",
            id: "msg-1",
          },
          {
            role: "tool",
            content: { foo: 42 },
            id: "tool-1",
          },
        ],
      },
      output: {
        type: "chat_messages",
        value: [
          {
            role: "assistant",
            content: { bar: 99 },
            id: "choice-1",
            finish_reason: "end_turn",
            tool_result: void 0,
          },
        ],
      },
    });
  });

  it("returns null if no events", () => {
    expect(extractStrandsAgentsInputOutput({})).toBeNull();
  });

  it("parses content/message as JSON or string for input and output", () => {
    const span: DeepPartial<ISpan> = {
      events: [
        // content is a valid JSON string (should parse to object)
        {
          name: "gen_ai.user.message",
          attributes: [
            { key: "role", value: { stringValue: "user" } },
            { key: "content", value: { stringValue: '{"foo":123}' } },
            { key: "id", value: { stringValue: "msg-1" } },
          ],
        },
        // content is a plain string (should remain string)
        {
          name: "gen_ai.tool.message",
          attributes: [
            { key: "role", value: { stringValue: "tool" } },
            { key: "content", value: { stringValue: "plain string" } },
            { key: "id", value: { stringValue: "tool-1" } },
          ],
        },
        // message is a valid JSON string (should parse to object)
        {
          name: "gen_ai.choice",
          attributes: [
            { key: "message", value: { stringValue: '{"bar":456}' } },
            { key: "id", value: { stringValue: "choice-1" } },
            { key: "finish_reason", value: { stringValue: "end_turn" } },
          ],
        },
        // message is a plain string (should remain string)
        {
          name: "gen_ai.choice",
          attributes: [
            { key: "message", value: { stringValue: "just a string" } },
            { key: "id", value: { stringValue: "choice-2" } },
            { key: "finish_reason", value: { stringValue: "end_turn" } },
          ],
        },
      ] as unknown as IEvent[],
    };
    const result = extractStrandsAgentsInputOutput(span);
    expect(result).toEqual({
      input: {
        type: "chat_messages",
        value: [
          {
            role: "user",
            content: { foo: 123 },
            id: "msg-1",
          },
          {
            role: "tool",
            content: "plain string",
            id: "tool-1",
          },
        ],
      },
      output: {
        type: "chat_messages",
        value: [
          {
            role: "assistant",
            content: { bar: 456 },
            id: "choice-1",
            finish_reason: "end_turn",
            tool_result: void 0,
          },
          {
            role: "assistant",
            content: "just a string",
            id: "choice-2",
            finish_reason: "end_turn",
            tool_result: void 0,
          },
        ],
      },
    });
  });

  it("assigns 'assistant' role to choice when role is missing and finish_reason is 'end_turn'", () => {
    const span: DeepPartial<ISpan> = {
      events: [
        {
          name: "gen_ai.choice",
          attributes: [
            { key: "message", value: { stringValue: '"response"' } },
            { key: "id", value: { stringValue: "choice-1" } },
            { key: "finish_reason", value: { stringValue: "end_turn" } },
            // No 'role' attribute
          ],
        },
        {
          name: "gen_ai.choice",
          attributes: [
            { key: "message", value: { stringValue: '"response2"' } },
            { key: "id", value: { stringValue: "choice-2" } },
            { key: "finish_reason", value: { stringValue: "not_end_turn" } },
            // No 'role' attribute
          ],
        },
        {
          name: "gen_ai.choice",
          attributes: [
            { key: "message", value: { stringValue: '"response3"' } },
            { key: "id", value: { stringValue: "choice-3" } },
            { key: "finish_reason", value: { stringValue: "end_turn" } },
            { key: "role", value: { stringValue: "customrole" } },
          ],
        },
      ] as unknown as IEvent[],
    };
    const result = extractStrandsAgentsInputOutput(span);
    expect(result?.output?.value).toEqual([
      {
        role: "assistant",
        content: "response",
        id: "choice-1",
        finish_reason: "end_turn",
        tool_result: void 0,
      },
      {
        role: void 0,
        content: "response2",
        id: "choice-2",
        finish_reason: "not_end_turn",
        tool_result: void 0,
      },
      {
        role: "customrole",
        content: "response3",
        id: "choice-3",
        finish_reason: "end_turn",
        tool_result: void 0,
      },
    ]);
  });
});

describe("extractStrandsAgentsMetadata", () => {
  it("returns empty object for span with no attributes", () => {
    const span: DeepPartial<ISpan> = {};
    const result = extractStrandsAgentsMetadata(span);
    expect(result).toEqual({});
  });

  it("returns empty object for span with null attributes", () => {
    const span: DeepPartial<ISpan> = { attributes: null as any };
    const result = extractStrandsAgentsMetadata(span);
    expect(result).toEqual({});
  });

  it("returns empty object for span with undefined attributes", () => {
    const span: DeepPartial<ISpan> = { attributes: undefined };
    const result = extractStrandsAgentsMetadata(span);
    expect(result).toEqual({});
  });

  it("extracts string attributes that don't start with scope or gen_ai", () => {
    const span: DeepPartial<ISpan> = {
      attributes: [
        { key: "custom.attribute", value: { stringValue: "test value" } },
        { key: "user.id", value: { stringValue: "user123" } },
        { key: "session.name", value: { stringValue: "session1" } },
      ],
    };
    const result = extractStrandsAgentsMetadata(span);
    expect(result).toEqual({
      "custom.attribute": "test value",
      "user.id": "user123",
      "session.name": "session1",
    });
  });

  it("filters out attributes starting with scope", () => {
    const span: DeepPartial<ISpan> = {
      attributes: [
        { key: "scope.name", value: { stringValue: "test" } },
        { key: "scope.version", value: { stringValue: "1.0" } },
        { key: "custom.attr", value: { stringValue: "should include" } },
      ],
    };
    const result = extractStrandsAgentsMetadata(span);
    expect(result).toEqual({
      "custom.attr": "should include",
    });
  });

  it("filters out attributes starting with gen_ai", () => {
    const span: DeepPartial<ISpan> = {
      attributes: [
        { key: "gen_ai.model", value: { stringValue: "gpt-4" } },
        { key: "gen_ai.temperature", value: { doubleValue: 0.7 } },
        { key: "custom.attr", value: { stringValue: "should include" } },
      ],
    };
    const result = extractStrandsAgentsMetadata(span);
    expect(result).toEqual({
      "custom.attr": "should include",
    });
  });

  it("extracts boolean attributes", () => {
    const span: DeepPartial<ISpan> = {
      attributes: [
        { key: "feature.enabled", value: { boolValue: true } },
        { key: "debug.mode", value: { boolValue: false } },
      ],
    };
    const result = extractStrandsAgentsMetadata(span);
    expect(result).toEqual({
      "feature.enabled": true,
      "debug.mode": false,
    });
  });

  it("extracts integer attributes", () => {
    const span: DeepPartial<ISpan> = {
      attributes: [
        { key: "request.count", value: { intValue: 42 } },
        { key: "user.age", value: { intValue: 25 } },
      ],
    };
    const result = extractStrandsAgentsMetadata(span);
    expect(result).toEqual({
      "request.count": 42,
      "user.age": 25,
    });
  });

  it("extracts double attributes", () => {
    const span: DeepPartial<ISpan> = {
      attributes: [
        { key: "response.time", value: { doubleValue: 1.234 } },
        { key: "accuracy.score", value: { doubleValue: 0.95 } },
      ],
    };
    const result = extractStrandsAgentsMetadata(span);
    expect(result).toEqual({
      "response.time": 1.234,
      "accuracy.score": 0.95,
    });
  });

  it("extracts bytes attributes", () => {
    const span: DeepPartial<ISpan> = {
      attributes: [
        {
          key: "data.hash",
          value: { bytesValue: new Uint8Array([1, 2, 3, 4]) },
        },
      ],
    };
    const result = extractStrandsAgentsMetadata(span);
    expect(result).toEqual({
      "data.hash": new Uint8Array([1, 2, 3, 4]),
    });
  });

  it("skips attributes with null or undefined values", () => {
    const span: DeepPartial<ISpan> = {
      attributes: [
        { key: "valid.attr", value: { stringValue: "valid" } },
        { key: "null.attr", value: { stringValue: null } },
        { key: "undefined.attr", value: { stringValue: undefined } },
        { key: "empty.attr", value: { stringValue: "" } },
      ],
    };
    const result = extractStrandsAgentsMetadata(span);
    expect(result).toEqual({
      "valid.attr": "valid",
    });
  });

  it("skips attributes with missing key or value", () => {
    const span: DeepPartial<ISpan> = {
      attributes: [
        { key: "valid.attr", value: { stringValue: "valid" } },
        { key: null as any, value: { stringValue: "no key" } },
        { key: "no.value", value: null as any },
        { key: "undefined.value", value: undefined },
      ],
    };
    const result = extractStrandsAgentsMetadata(span);
    expect(result).toEqual({
      "valid.attr": "valid",
    });
  });

  it("handles mixed attribute types correctly", () => {
    const span: DeepPartial<ISpan> = {
      attributes: [
        { key: "string.attr", value: { stringValue: "hello" } },
        { key: "bool.attr", value: { boolValue: true } },
        { key: "int.attr", value: { intValue: 42 } },
        { key: "double.attr", value: { doubleValue: 3.14 } },
        { key: "bytes.attr", value: { bytesValue: new Uint8Array([255]) } },
        { key: "scope.should.filter", value: { stringValue: "filtered" } },
        { key: "gen_ai.should.filter", value: { stringValue: "filtered" } },
      ],
    };
    const result = extractStrandsAgentsMetadata(span);
    expect(result).toEqual({
      "string.attr": "hello",
      "bool.attr": true,
      "int.attr": 42,
      "double.attr": 3.14,
      "bytes.attr": new Uint8Array([255]),
    });
  });

  it("extracts complex attribute types (kvlistValue, arrayValue)", () => {
    const span: DeepPartial<ISpan> = {
      attributes: [
        { key: "simple.attr", value: { stringValue: "simple" } },
        {
          key: "complex.attr",
          value: {
            kvlistValue: {
              values: [
                { key: "nested.key", value: { stringValue: "nested value" } },
                { key: "nested.number", value: { intValue: 42 } },
              ],
            },
          },
        },
        {
          key: "array.attr",
          value: {
            arrayValue: {
              values: [
                { stringValue: "item1" },
                { intValue: 123 },
                { boolValue: true },
              ],
            },
          },
        },
      ],
    };
    const result = extractStrandsAgentsMetadata(span);
    expect(result).toEqual({
      "simple.attr": "simple",
      "complex.attr": {
        nested: {
          key: "nested value",
          number: 42,
        },
      },
      "array.attr": ["item1", 123, true],
    });
  });

  it("handles edge case with empty string values", () => {
    const span: DeepPartial<ISpan> = {
      attributes: [
        { key: "empty.string", value: { stringValue: "" } },
        { key: "valid.string", value: { stringValue: "not empty" } },
      ],
    };
    const result = extractStrandsAgentsMetadata(span);
    expect(result).toEqual({
      "valid.string": "not empty",
    });
  });

  it("handles zero values correctly", () => {
    const span: DeepPartial<ISpan> = {
      attributes: [
        { key: "zero.int", value: { intValue: 0 } },
        { key: "zero.double", value: { doubleValue: 0.0 } },
        { key: "false.bool", value: { boolValue: false } },
      ],
    };
    const result = extractStrandsAgentsMetadata(span);
    expect(result).toEqual({
      "zero.int": 0,
      "zero.double": 0.0,
      "false.bool": false,
    });
  });

  it("handles attributes with multiple value types set (should use first defined)", () => {
    const span: DeepPartial<ISpan> = {
      attributes: [
        {
          key: "mixed.attr",
          value: {
            stringValue: "string value",
            intValue: 42,
            boolValue: true,
          },
        },
      ],
    };
    const result = extractStrandsAgentsMetadata(span);
    expect(result).toEqual({
      "mixed.attr": "string value", // Should use stringValue since it's checked first
    });
  });

  it("handles case sensitivity in attribute key filtering", () => {
    const span: DeepPartial<ISpan> = {
      attributes: [
        { key: "SCOPE.name", value: { stringValue: "should include" } },
        { key: "scope.name", value: { stringValue: "should filter" } },
        { key: "GEN_AI.model", value: { stringValue: "should include" } },
        { key: "gen_ai.model", value: { stringValue: "should filter" } },
      ],
    };
    const result = extractStrandsAgentsMetadata(span);
    expect(result).toEqual({
      "SCOPE.name": "should include",
      "GEN_AI.model": "should include",
    });
  });

  it("handles attributes with empty array", () => {
    const span: DeepPartial<ISpan> = {
      attributes: [],
    };
    const result = extractStrandsAgentsMetadata(span);
    expect(result).toEqual({});
  });

  it("handles attributes with undefined/null in the array", () => {
    const span: DeepPartial<ISpan> = {
      attributes: [
        { key: "valid.attr", value: { stringValue: "valid" } },
        null as any,
        undefined as any,
        { key: "another.valid", value: { stringValue: "also valid" } },
      ],
    };
    const result = extractStrandsAgentsMetadata(span);
    expect(result).toEqual({
      "valid.attr": "valid",
      "another.valid": "also valid",
    });
  });

  it("handles attributes with whitespace-only string values", () => {
    const span: DeepPartial<ISpan> = {
      attributes: [
        { key: "whitespace.attr", value: { stringValue: "   " } },
        { key: "valid.attr", value: { stringValue: "valid" } },
        { key: "tab.attr", value: { stringValue: "\t\n" } },
        { key: "empty.attr", value: { stringValue: "" } },
      ],
    };
    const result = extractStrandsAgentsMetadata(span);
    expect(result).toEqual({
      "whitespace.attr": "   ",
      "valid.attr": "valid",
      "tab.attr": "\t\n",
    });
  });

  it("handles attributes with numeric string values", () => {
    const span: DeepPartial<ISpan> = {
      attributes: [
        { key: "numeric.string", value: { stringValue: "123" } },
        { key: "decimal.string", value: { stringValue: "3.14" } },
        { key: "negative.string", value: { stringValue: "-42" } },
      ],
    };
    const result = extractStrandsAgentsMetadata(span);
    expect(result).toEqual({
      "numeric.string": "123",
      "decimal.string": "3.14",
      "negative.string": "-42",
    });
  });

  it("handles deeply nested kvlistValue structures", () => {
    const span: DeepPartial<ISpan> = {
      attributes: [
        {
          key: "deeply.nested",
          value: {
            kvlistValue: {
              values: [
                {
                  key: "level1",
                  value: {
                    kvlistValue: {
                      values: [
                        {
                          key: "level2.key",
                          value: { stringValue: "deep value" },
                        },
                        { key: "level2.number", value: { intValue: 999 } },
                      ],
                    },
                  },
                },
                { key: "top.level", value: { stringValue: "top value" } },
              ],
            },
          },
        },
      ],
    };
    const result = extractStrandsAgentsMetadata(span);
    expect(result).toEqual({
      "deeply.nested": {
        level1: {
          level2: {
            key: "deep value",
            number: 999,
          },
        },
        top: {
          level: "top value",
        },
      },
    });
  });

  it("handles mixed complex types in arrays", () => {
    const span: DeepPartial<ISpan> = {
      attributes: [
        {
          key: "mixed.array",
          value: {
            arrayValue: {
              values: [
                { stringValue: "string item" },
                { intValue: 456 },
                { boolValue: false },
                {
                  kvlistValue: {
                    values: [
                      {
                        key: "nested.key",
                        value: { stringValue: "nested in array" },
                      },
                    ],
                  },
                },
                {
                  arrayValue: {
                    values: [{ stringValue: "nested array item" }],
                  },
                },
              ],
            },
          },
        },
      ],
    };
    const result = extractStrandsAgentsMetadata(span);
    expect(result).toEqual({
      "mixed.array": [
        "string item",
        456,
        false,
        {
          nested: {
            key: "nested in array",
          },
        },
        ["nested array item"],
      ],
    });
  });

  it("handles empty complex types", () => {
    const span: DeepPartial<ISpan> = {
      attributes: [
        { key: "empty.kvlist", value: { kvlistValue: { values: [] } } },
        { key: "empty.array", value: { arrayValue: { values: [] } } },
        { key: "valid.attr", value: { stringValue: "valid" } },
      ],
    };
    const result = extractStrandsAgentsMetadata(span);
    expect(result).toEqual({
      "empty.kvlist": {},
      "empty.array": [],
      "valid.attr": "valid",
    });
  });

  it("handles complex types with filtering (scope/gen_ai)", () => {
    const span: DeepPartial<ISpan> = {
      attributes: [
        {
          key: "valid.complex",
          value: {
            kvlistValue: {
              values: [{ key: "nested", value: { stringValue: "valid" } }],
            },
          },
        },
        {
          key: "scope.should.filter",
          value: {
            kvlistValue: {
              values: [{ key: "nested", value: { stringValue: "filtered" } }],
            },
          },
        },
        {
          key: "gen_ai.should.filter",
          value: { arrayValue: { values: [{ stringValue: "filtered" }] } },
        },
      ],
    };
    const result = extractStrandsAgentsMetadata(span);
    expect(result).toEqual({
      "valid.complex": {
        nested: "valid",
      },
    });
  });

  it("handles JSON parsing in string values within complex types", () => {
    const span: DeepPartial<ISpan> = {
      attributes: [
        {
          key: "json.in.kvlist",
          value: {
            kvlistValue: {
              values: [
                {
                  key: "json.string",
                  value: { stringValue: '{"key": "value", "number": 42}' },
                },
                { key: "plain.string", value: { stringValue: "plain text" } },
              ],
            },
          },
        },
        {
          key: "json.in.array",
          value: {
            arrayValue: {
              values: [
                { stringValue: '{"nested": {"deep": "value"}}' },
                { stringValue: "not json" },
              ],
            },
          },
        },
      ],
    };
    const result = extractStrandsAgentsMetadata(span);
    expect(result).toEqual({
      "json.in.kvlist": {
        json: {
          string: { key: "value", number: 42 },
        },
        plain: {
          string: "plain text",
        },
      },
      "json.in.array": [{ nested: { deep: "value" } }, "not json"],
    });
  });
});
