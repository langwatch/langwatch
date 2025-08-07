import { describe, it, expect } from "vitest";
import { extractStrandsAgentsInputOutput, isStrandsAgentsInstrumentation } from "./strands-agents";
import type { DeepPartial } from "~/utils/types";
import type { ISpan, IEvent } from "@opentelemetry/otlp-transformer";

describe("isStrandsAgentsInstrumentation", () => {
  it("returns true for scope.name === 'strands-agents'", () => {
    expect(
      isStrandsAgentsInstrumentation({ name: "strands-agents" }, {})
    ).toBe(true);
  });
  it("returns true for scope.attributes['gen_ai.system'] === 'strands-agents'", () => {
    expect(
      isStrandsAgentsInstrumentation({ attributes: [{ key: "gen_ai.system", value: { stringValue: "strands-agents" } }] }, {})
    ).toBe(true);
  });
  it("returns true for scope.attributes['system.name'] === 'strands-agents'", () => {
    expect(
      isStrandsAgentsInstrumentation({ attributes: [{ key: "system.name", value: { stringValue: "strands-agents" } }] }, {})
    ).toBe(true);
  });
  it("returns true for span.attributes['gen_ai.agent.name'] === 'Strands Agents'", () => {
    expect(
      isStrandsAgentsInstrumentation({}, { attributes: [{ key: "gen_ai.agent.name", value: { stringValue: "Strands Agents" } }] })
    ).toBe(true);
  });
  it("returns true for span.attributes['service.name'] === 'strands-agents'", () => {
    expect(
      isStrandsAgentsInstrumentation({}, { attributes: [{ key: "service.name", value: { stringValue: "strands-agents" } }] })
    ).toBe(true);
  });
  it("returns true for span.name.includes('Agents')", () => {
    expect(
      isStrandsAgentsInstrumentation({}, { name: "invoke_agent Strands Agents" })
    ).toBe(true);
  });
  it("returns true for scope.name === 'opentelemetry.instrumentation.strands'", () => {
    expect(
      isStrandsAgentsInstrumentation({ name: "opentelemetry.instrumentation.strands" }, {})
    ).toBe(true);
  });
  it("returns false for wrong service name", () => {
    expect(
      isStrandsAgentsInstrumentation({}, { attributes: [{ key: "service.name", value: { stringValue: "other-service" } }] })
    ).toBe(false);
  });
  it("returns false for null scope and span", () => {
    expect(isStrandsAgentsInstrumentation(null as any, null as any)).toBe(false);
  });
  it("returns false for undefined scope and span", () => {
    expect(isStrandsAgentsInstrumentation(undefined as any, undefined as any)).toBe(false);
  });
  it("returns false when no relevant attributes present", () => {
    expect(
      isStrandsAgentsInstrumentation({}, {})
    ).toBe(false);
  });
  it("returns false when service.name is not a string", () => {
    expect(
      isStrandsAgentsInstrumentation({}, { attributes: [{ key: "service.name", value: { intValue: 42 } }] })
    ).toBe(false);
  });
});

describe("isStrandsAgentsInstrumentation (extensive attribute checks)", () => {
  it("returns true for scope.name === 'strands-agents' (exact match)", () => {
    expect(isStrandsAgentsInstrumentation({ name: "strands-agents" }, {})).toBe(true);
  });
  it("returns false for scope.name !== 'strands-agents'", () => {
    expect(isStrandsAgentsInstrumentation({ name: "other" }, {})).toBe(false);
  });

  it("returns true for scope.attributes['gen_ai.system'] === 'strands-agents'", () => {
    expect(isStrandsAgentsInstrumentation({ attributes: [{ key: "gen_ai.system", value: { stringValue: "strands-agents" } }] }, {})).toBe(true);
  });
  it("returns false for scope.attributes['gen_ai.system'] !== 'strands-agents'", () => {
    expect(isStrandsAgentsInstrumentation({ attributes: [{ key: "gen_ai.system", value: { stringValue: "other" } }] }, {})).toBe(false);
  });
  it("returns false for scope.attributes['gen_ai.system'] with wrong value type", () => {
    expect(isStrandsAgentsInstrumentation({ attributes: [{ key: "gen_ai.system", value: { intValue: 42 } }] }, {})).toBe(false);
  });

  it("returns true for scope.attributes['system.name'] === 'strands-agents'", () => {
    expect(isStrandsAgentsInstrumentation({ attributes: [{ key: "system.name", value: { stringValue: "strands-agents" } }] }, {})).toBe(true);
  });
  it("returns false for scope.attributes['system.name'] !== 'strands-agents'", () => {
    expect(isStrandsAgentsInstrumentation({ attributes: [{ key: "system.name", value: { stringValue: "other" } }] }, {})).toBe(false);
  });
  it("returns false for scope.attributes['system.name'] with wrong value type", () => {
    expect(isStrandsAgentsInstrumentation({ attributes: [{ key: "system.name", value: { intValue: 42 } }] }, {})).toBe(false);
  });

  it("returns true for span.attributes['gen_ai.agent.name'] === 'Strands Agents'", () => {
    expect(isStrandsAgentsInstrumentation({}, { attributes: [{ key: "gen_ai.agent.name", value: { stringValue: "Strands Agents" } }] })).toBe(true);
  });
  it("returns false for span.attributes['gen_ai.agent.name'] !== 'Strands Agents'", () => {
    expect(isStrandsAgentsInstrumentation({}, { attributes: [{ key: "gen_ai.agent.name", value: { stringValue: "Other Agent" } }] })).toBe(false);
  });
  it("returns false for span.attributes['gen_ai.agent.name'] with wrong value type", () => {
    expect(isStrandsAgentsInstrumentation({}, { attributes: [{ key: "gen_ai.agent.name", value: { intValue: 42 } }] })).toBe(false);
  });

  it("returns true for span.attributes['service.name'] === 'strands-agents'", () => {
    expect(isStrandsAgentsInstrumentation({}, { attributes: [{ key: "service.name", value: { stringValue: "strands-agents" } }] })).toBe(true);
  });
  it("returns false for span.attributes['service.name'] !== 'strands-agents'", () => {
    expect(isStrandsAgentsInstrumentation({}, { attributes: [{ key: "service.name", value: { stringValue: "other-service" } }] })).toBe(false);
  });
  it("returns false for span.attributes['service.name'] with wrong value type", () => {
    expect(isStrandsAgentsInstrumentation({}, { attributes: [{ key: "service.name", value: { intValue: 42 } }] })).toBe(false);
  });

  it("returns false if none of the attributes match", () => {
    expect(isStrandsAgentsInstrumentation({ name: "not-strands" }, { attributes: [{ key: "foo", value: { stringValue: "bar" } }] })).toBe(false);
  });

  it("returns false for missing attributes arrays", () => {
    expect(isStrandsAgentsInstrumentation({}, {})).toBe(false);
    expect(isStrandsAgentsInstrumentation({ attributes: undefined }, { attributes: undefined })).toBe(false);
  });

  it("returns false for null or undefined scope/span", () => {
    expect(isStrandsAgentsInstrumentation(null as any, null as any)).toBe(false);
    expect(isStrandsAgentsInstrumentation(undefined as any, undefined as any)).toBe(false);
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
