import { admitsCodingAgentSpan } from "@langwatch/coding-agent-contract";
import { NormalizedSpanKind, type NormalizedSpan } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { liftSpanContribution } from "../coding-agent-span-facts.rules.ts";

const TRACE_ID = "trace-1";

function span(overrides: Partial<NormalizedSpan>): NormalizedSpan {
  return {
    id: "row-1",
    traceId: TRACE_ID,
    spanId: "span-1",
    tenantId: "project-1",
    parentSpanId: null,
    parentTraceId: null,
    parentIsRemote: null,
    sampled: true,
    startTimeUnixMs: 1_000,
    endTimeUnixMs: 2_000,
    durationMs: 1_000,
    name: "claude_code.tool",
    kind: NormalizedSpanKind.INTERNAL,
    resourceAttributes: {},
    spanAttributes: {},
    events: [],
    links: [],
    statusMessage: null,
    statusCode: null,
    instrumentationScope: { name: "com.anthropic.claude_code", version: null },
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
    cost: null,
    nonBilledCost: null,
    ...overrides,
  };
}

describe("admitsCodingAgentSpan", () => {
  /** @scenario "a foreign span reusing codex's bare turn name is declined at the gate" */
  it("declines a bare declared name whose scope names no coding agent", () => {
    expect(
      admitsCodingAgentSpan({ name: "session_task.turn", scopeName: "com.acme.pipeline" }),
    ).toBe(false);
  });
});

describe("liftSpanContribution", () => {
  /** @scenario a session without a session id is not lost */
  it("degrades to the trace id as a one-trace session", () => {
    const lifted = liftSpanContribution({
      tenantId: "project-1",
      occurredAt: 3_000,
      span: span({ spanAttributes: { tool_name: "Bash" } }),
    });

    expect(lifted.sessionId).toBe(TRACE_ID);
    expect(lifted.sessionKeySource).toBe("trace_fallback");
  });

  /** @scenario Cowork telemetry that shares Claude Code's event vocabulary is still Cowork */
  it("labels the contribution claude_cowork from the resource service", () => {
    const lifted = liftSpanContribution({
      tenantId: "project-1",
      occurredAt: 3_000,
      span: span({
        name: "claude_code.llm_request",
        spanAttributes: { "gen_ai.conversation.id": "cw-sess-1" },
        resourceAttributes: { "service.name": "cowork" },
      }),
    });

    expect(lifted.agent).toBe("claude_cowork");
    expect(lifted.sessionId).toBe("cw-sess-1");
  });
});
