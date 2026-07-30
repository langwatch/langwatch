import { describe, expect, it } from "vitest";
import { createTenantId } from "~/server/event-sourcing.old";
import {
  asSet,
  assertOrderInvariant,
  type OrderInvariant,
} from "~/server/event-sourcing.old/projections/orderInvariance";
import {
  LOG_FACTS_CONTRIBUTED_EVENT_TYPE,
  SPAN_FACTS_CONTRIBUTED_EVENT_TYPE,
} from "../../schemas/constants";
import type {
  LogFactsContributedEvent,
  SpanFactsContributedEvent,
} from "../../schemas/events";
import {
  CodingAgentSessionFoldProjection,
  type CodingAgentSessionState,
} from "../codingAgentSession.foldProjection";

/**
 * The fold's order-insensitivity, checked rather than asserted.
 *
 * `refoldOnOutOfOrder: false` on this fold is the CLAIM that its accumulators
 * commute — sums, counters, bounded first-seen sets, a max checkpoint — so a
 * late contribution folds onto the loaded state in place and replaying the
 * history derives nothing. On most folds that claim has never been checked;
 * this is the check for this one, and it is what moves the fold out of the
 * order-invariance ratchet's unproven list.
 *
 * The comparison is an explicit VIEW, not deep equality:
 * `AbstractFoldProjection.apply` stamps `updatedAt` from wall-clock time on
 * every apply, so no two orderings can ever produce byte-identical state.
 */

const SESSION_ID = "8f2c9a1e-4711-4e0f-9d2e-session";
const TRACE_A = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6";
const TRACE_B = "b1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d7";

function projection() {
  return new CodingAgentSessionFoldProjection({
    store: { store: async () => {}, get: async () => null },
  });
}

function spanEvent({
  id,
  name,
  spanId,
  traceId = TRACE_A,
  facts = {},
  startMs,
  endMs,
}: {
  id: string;
  name: string;
  spanId: string;
  traceId?: string;
  facts?: Record<string, string | number | boolean>;
  startMs: number;
  endMs: number;
}): SpanFactsContributedEvent {
  return {
    id,
    occurredAt: startMs,
    createdAt: startMs,
    tenantId: createTenantId("tenant-1"),
    type: SPAN_FACTS_CONTRIBUTED_EVENT_TYPE,
    data: {
      tenantId: "tenant-1",
      sessionId: SESSION_ID,
      sessionKeySource: "provider",
      agent: "claude_code",
      occurredAt: startMs,
      traceId,
      spanId,
      name,
      startTimeUnixMs: startMs,
      endTimeUnixMs: endMs,
      statusCode: 0,
      facts,
      scopeName: "com.anthropic.claude_code.tracing",
    },
  } as unknown as SpanFactsContributedEvent;
}

function logEvent({
  id,
  facts,
  timeMs,
}: {
  id: string;
  facts: Record<string, string | number | boolean>;
  timeMs: number;
}): LogFactsContributedEvent {
  return {
    id,
    occurredAt: timeMs,
    createdAt: timeMs,
    tenantId: createTenantId("tenant-1"),
    type: LOG_FACTS_CONTRIBUTED_EVENT_TYPE,
    data: {
      tenantId: "tenant-1",
      sessionId: SESSION_ID,
      sessionKeySource: "provider",
      agent: "claude_code",
      occurredAt: timeMs,
      recordId: `rec-${id}`,
      traceId: null,
      spanId: null,
      timeUnixMs: timeMs,
      severityNumber: 9,
      providerKind: "claude_code",
      scopeName: "com.anthropic.claude_code.events",
      facts,
    },
  } as unknown as LogFactsContributedEvent;
}

/**
 * What must not depend on arrival order. Named one by one rather than compared
 * wholesale, so a failure says which claim broke — and so the claims are
 * written down instead of implied by whatever happens to sit on the state.
 */
const INVARIANTS: readonly OrderInvariant<CodingAgentSessionState>[] = [
  { name: "modelCalls", of: (state) => state.modelCalls },
  { name: "toolCalls", of: (state) => state.toolCalls },
  { name: "inputTokens", of: (state) => state.inputTokens },
  { name: "outputTokens", of: (state) => state.outputTokens },
  { name: "costUsd", of: (state) => state.costUsd },
  { name: "modelCallMs", of: (state) => state.modelCallMs },
  { name: "toolMs", of: (state) => state.toolMs },
  { name: "toolCounts", of: (state) => state.toolCounts },
  { name: "traceIds (as a set)", of: (state) => asSet(state.traceIds) },
  { name: "filesTouched (as a set)", of: (state) => asSet(state.filesTouched) },
  { name: "models (as a set)", of: (state) => asSet(state.models) },
  { name: "startedAtMs (earliest wins)", of: (state) => state.startedAtMs },
  {
    name: "LastEventOccurredAt (latest wins)",
    of: (state) => state.LastEventOccurredAt,
  },
  {
    name: "steps in the order they happened",
    of: (state) =>
      state.steps.map((step) => [step.name, step.count, step.startedAtMs]),
  },
];

describe("codingAgentSession order invariance", () => {
  describe("given a session's contributions arriving in any order", () => {
    const events = [
      spanEvent({
        id: "e1",
        name: "claude_code.model.call",
        spanId: "s1",
        startMs: 1_000,
        endMs: 1_400,
        facts: {
          "gen_ai.request.model": "claude-sonnet",
          "gen_ai.usage.input_tokens": 120,
          "gen_ai.usage.output_tokens": 40,
        },
      }),
      spanEvent({
        id: "e2",
        name: "claude_code.tool.execute",
        spanId: "s2",
        startMs: 1_500,
        endMs: 1_700,
        facts: { "tool.name": "Read", "file.path": "a.ts" },
      }),
      spanEvent({
        id: "e3",
        name: "claude_code.tool.execute",
        spanId: "s3",
        traceId: TRACE_B,
        startMs: 2_000,
        endMs: 2_100,
        facts: { "tool.name": "Edit", "file.path": "b.ts" },
      }),
      spanEvent({
        id: "e4",
        name: "claude_code.model.call",
        spanId: "s4",
        startMs: 2_500,
        endMs: 3_000,
        facts: {
          "gen_ai.request.model": "claude-haiku",
          "gen_ai.usage.input_tokens": 80,
          "gen_ai.usage.output_tokens": 15,
        },
      }),
      logEvent({
        id: "e5",
        timeMs: 2_800,
        facts: { "event.name": "claude_code.user_prompt", prompt_length: 42 },
      }),
    ];

    /** @scenario an out-of-order event is folded in place, not replayed */
    it("reaches the same state under every ordering of its contributions", () => {
      const result = assertOrderInvariant({
        projection: projection(),
        events,
        invariants: INVARIANTS,
      });

      // Five events is 120 orderings — every one of them, not a sample.
      expect(result.exhaustive).toBe(true);
      expect(result.orderings).toBe(120);
    });
  });
});
