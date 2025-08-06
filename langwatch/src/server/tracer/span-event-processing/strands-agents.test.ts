import { describe, it, expect } from "vitest";
import { extractStrandsAgentsInputOutput, isStrandsAgentsPythonResource } from "./strands-agents";
import type { DeepPartial } from "~/utils/types";
import type { ISpan, IEvent } from "@opentelemetry/otlp-transformer";

describe("isStrandsAgentsPythonResource", () => {
  it("returns true for correct resource", () => {
    expect(
      isStrandsAgentsPythonResource({
        "service.name": "strands-agents",
        "telemetry.sdk.language": "python",
      })
    ).toBe(true);
  });
  it("returns false for wrong service name", () => {
    expect(
      isStrandsAgentsPythonResource({
        "service.name": "other-service",
        "telemetry.sdk.language": "python",
      })
    ).toBe(false);
  });
  it("returns false for wrong sdk language", () => {
    expect(
      isStrandsAgentsPythonResource({
        "service.name": "strands-agents",
        "telemetry.sdk.language": "javascript",
      })
    ).toBe(false);
  });
  it("returns false for null resource", () => {
    expect(isStrandsAgentsPythonResource(null as any)).toBe(false);
  });
  
  it("returns false for undefined resource", () => {
    expect(isStrandsAgentsPythonResource(undefined as any)).toBe(false);
  });
  
  it("returns false when service.name is missing", () => {
    expect(
      isStrandsAgentsPythonResource({
        "telemetry.sdk.language": "python",
      })
    ).toBe(false);
  });
  
  it("returns false when telemetry.sdk.language is missing", () => {
    expect(
      isStrandsAgentsPythonResource({
        "service.name": "strands-agents",
      })
    ).toBe(false);
  });
  it("returns false when service.name is not a string", () => {
    expect(
      isStrandsAgentsPythonResource({
        "service.name": 42,
        "telemetry.sdk.language": "python",
      })
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
