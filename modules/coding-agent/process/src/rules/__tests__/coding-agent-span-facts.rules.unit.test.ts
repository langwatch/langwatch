import { admitsCodingAgentSpan } from "@langwatch/coding-agent-contract";
import { NormalizedSpanKind, type NormalizedSpan } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { liftSpanContribution, type SpanContribution } from "../coding-agent-span-facts.rules.ts";

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

function contributionOf(lifted: SpanContribution) {
  if (lifted.outcome === "ignored") throw new Error("expected the span to contribute");
  return lifted.contribution;
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
    const lifted = contributionOf(
      liftSpanContribution({
        tenantId: "project-1",
        occurredAt: 3_000,
        span: span({ spanAttributes: { tool_name: "Bash" } }),
      }),
    );

    expect(lifted.sessionId).toBe(TRACE_ID);
    expect(lifted.sessionKeySource).toBe("trace_fallback");
  });

  /** @scenario Cowork telemetry that shares Claude Code's event vocabulary is still Cowork */
  it("labels the contribution claude_cowork from the resource service", () => {
    const lifted = contributionOf(
      liftSpanContribution({
        tenantId: "project-1",
        occurredAt: 3_000,
        span: span({
          name: "claude_code.llm_request",
          spanAttributes: { "gen_ai.conversation.id": "cw-sess-1" },
          resourceAttributes: { "service.name": "cowork" },
        }),
      }),
    );

    expect(lifted.agent).toBe("claude_cowork");
    expect(lifted.sessionId).toBe("cw-sess-1");
  });

  /** @scenario a launcher's declared session groups every harness session it runs */
  it("keys the span on the launcher's declared session over Claude Code's own", () => {
    const lifted = contributionOf(
      liftSpanContribution({
        tenantId: "project-1",
        occurredAt: 3_000,
        span: span({
          name: "claude_code.llm_request",
          spanAttributes: { "session.id": "cc-run-2", "gen_ai.conversation.id": "channel_a" },
          resourceAttributes: { "langwatch.session.id": "agent_scout" },
        }),
      }),
    );

    expect(lifted.sessionId).toBe("agent_scout");
    expect(lifted.sessionKeySource).toBe("provider");
  });

  /** @scenario a session with no declared session is keyed by the agent's own session id */
  it("keys a plain Claude Code span on its session id over a declared thread", () => {
    const lifted = contributionOf(
      liftSpanContribution({
        tenantId: "project-1",
        occurredAt: 3_000,
        span: span({
          name: "claude_code.llm_request",
          spanAttributes: { "session.id": "cc-run-1", "gen_ai.conversation.id": "channel_a" },
        }),
      }),
    );

    expect(lifted.sessionId).toBe("cc-run-1");
  });
});
