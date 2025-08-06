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
            { key: "finish_reason", value: { stringValue: "stop" } },
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
            role: "choice",
            content: { bar: 99 },
            id: "choice-1",
            finish_reason: "stop",
          },
        ],
      },
    });
  });

  it("returns null if no events", () => {
    expect(extractStrandsAgentsInputOutput({})).toBeNull();
  });
});
