/**
 * A Grok turn as the trace summary fold sees it: log contributions only, correlated by Grok's
 * session and prompt ids. Attributes and the resource are a grok 1.0.70 capture's own keys.
 * @see specs/coding-agent/grok-sessions.feature
 */
import { createTenantId } from "@langwatch/eventing";
import {
  LOG_CONTRIBUTED_EVENT_TYPE,
  LOG_CONTRIBUTED_EVENT_VERSION_LATEST,
  type LogContributedEvent,
  type TraceSummaryData,
} from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { TraceCanonicalisationService } from "../../features/derivation/services/trace-canonicalisation.service.ts";
import { TraceAnalyticsFoldProjection } from "../trace-derived.projection.ts";
import { TraceSummaryFoldProjection } from "../trace-summary.projection.ts";
import { createInitState, createTestRuntime } from "./trace-summary-test.fixtures.ts";

const TRACE_ID = "0a1b2c3d4e5f60718293a4b5c6d7e8f9";
const TURN_START_MS = 1_793_000_000_000;
const canonicalisation = TraceCanonicalisationService.create();

function makeProjection() {
  return TraceSummaryFoldProjection.create({
    store: { store: async () => {}, get: async () => ({ kind: "empty" as const }) },
    traceCanonicalisation: canonicalisation,
    runtime: createTestRuntime(),
  });
}

let nextRecord = 0;

/** One Grok record's contribution, lifted by the real canonicaliser as the log module lifts it. */
function grokContribution({
  eventName,
  atMs,
  attributes = {},
  correlationSource = "grok_synthesized",
  acceptedAtMs = atMs + 2_000,
}: {
  eventName: string;
  atMs: number;
  attributes?: Record<string, string>;
  correlationSource?: LogContributedEvent["data"]["correlationSource"];
  acceptedAtMs?: number;
}): LogContributedEvent {
  nextRecord += 1;
  const lifted = canonicalisation.canonicalizeLogRecord({
    scopeName: "ai.xai.grok_code",
    body: "",
    attributes: { "event.name": eventName, "session.id": "01a1ab72", ...attributes },
  }).attributes;
  return {
    id: `evt-${nextRecord}`,
    type: LOG_CONTRIBUTED_EVENT_TYPE,
    version: LOG_CONTRIBUTED_EVENT_VERSION_LATEST,
    aggregateType: "trace",
    aggregateId: TRACE_ID,
    tenantId: createTenantId("tenant-1"),
    createdAt: acceptedAtMs,
    occurredAt: acceptedAtMs,
    data: {
      recordId: String(nextRecord).padStart(64, "0"),
      traceId: TRACE_ID,
      spanId: "1122334455667788",
      timeUnixMs: atMs,
      severityNumber: 9,
      severityText: "INFO",
      providerKind: "grok",
      scopeName: "ai.xai.grok_code",
      correlationSource,
      input: null,
      output: null,
      // The receiver's origin stamp, which the log module carries off the record's resource.
      liftedAttributes: {
        ...(lifted as Record<string, string>),
        "langwatch.origin": "coding_agent",
      },
      nonBillable: false,
      piiRedactionLevel: "DISABLED",
    },
    metadata: {},
  };
}

/** A turn's records, out of order as a batching exporter can deliver them. */
function grokTurn(): LogContributedEvent[] {
  return [
    grokContribution({
      eventName: "grok_code.api_request",
      atMs: TURN_START_MS + 3_783,
      attributes: { model: "grok-4.7", duration_ms: "3783" },
    }),
    grokContribution({
      eventName: "grok_code.user_prompt",
      atMs: TURN_START_MS,
      attributes: { model: "grok-4.7", prompt: "hi" },
    }),
    grokContribution({ eventName: "grok_code.assistant_response", atMs: TURN_START_MS + 4_120 }),
  ];
}

function fold(
  events: LogContributedEvent[],
  initial: TraceSummaryData = createInitState(),
): TraceSummaryData {
  const projection = makeProjection();
  return events.reduce(
    (state, event) => projection.handleTraceLogContributed(event, state),
    initial,
  );
}

describe("TraceSummaryFoldProjection, given a logs-only Grok turn", () => {
  /** @scenario "A Grok trace's origin is Coding Agent" */
  it("takes the coding-agent origin its records carry", () => {
    expect(fold(grokTurn()).attributes["langwatch.origin"]).toBe("coding_agent");
  });

  /** @scenario "A Grok trace lasts from its first record to its last" */
  it("spans the turn from its first record to its last, whatever order they arrive in", () => {
    const state = fold(grokTurn());

    expect(state.occurredAt).toBe(TURN_START_MS);
    expect(state.totalDurationMs).toBe(4_120);
  });

  /** @scenario "A Grok trace names the model its log records carry" */
  it("names the model Grok's records carry", () => {
    expect(fold(grokTurn()).models).toEqual(["grok-4.7"]);
  });

  it("never overrides an origin the trace already has", () => {
    const initial = createInitState();
    initial.attributes = { "langwatch.origin": "evaluation" };

    expect(fold(grokTurn(), initial).attributes["langwatch.origin"]).toBe("evaluation");
  });

  it("leaves the window to a record's spans when it carries its own trace context", () => {
    const state = fold([
      grokContribution({
        eventName: "grok_code.user_prompt",
        atMs: TURN_START_MS,
        correlationSource: "wire",
      }),
    ]);

    expect(state.occurredAt).toBe(0);
    expect(state.totalDurationMs).toBe(0);
  });

  /** @scenario "Only Grok's synthesized records time a trace" */
  it.each(["claude_synthesized", "codex_synthesized"] as const)(
    "leaves the window to spans for a %s record",
    (correlationSource) => {
      const state = fold([
        grokContribution({ eventName: "user_prompt", atMs: TURN_START_MS, correlationSource }),
        grokContribution({
          eventName: "api_request",
          atMs: TURN_START_MS + 900,
          correlationSource,
        }),
      ]);

      expect(state.occurredAt).toBe(0);
      expect(state.totalDurationMs).toBe(0);
    },
  );

  it("freezes the storage anchor where the analytics fold does: the first accept time", () => {
    const turn = grokTurn();
    const summary = makeProjection();
    const analytics = TraceAnalyticsFoldProjection.create({
      store: { store: async () => {}, get: async () => ({ kind: "empty" as const }) },
      traceCanonicalisation: canonicalisation,
      runtime: createTestRuntime(),
    });

    const summaryState = turn.reduce((s, e) => summary.apply(s, e), summary.init());
    const analyticsState = turn.reduce((s, e) => analytics.apply(s, e), analytics.init());

    expect(summaryState.storageAnchorMs).toBe(turn[0]!.occurredAt);
    expect(analyticsState.storageAnchorMs).toBe(summaryState.storageAnchorMs);
    expect(summaryState.occurredAt).toBe(TURN_START_MS);
  });

  it("ignores a record whose clock is days off its accept time", () => {
    const state = fold([
      grokContribution({
        eventName: "grok_code.user_prompt",
        atMs: TURN_START_MS - 5 * 24 * 60 * 60 * 1000,
        acceptedAtMs: TURN_START_MS,
      }),
      grokContribution({ eventName: "grok_code.assistant_response", atMs: TURN_START_MS + 900 }),
    ]);

    expect(state.occurredAt).toBe(TURN_START_MS + 900);
    expect(state.totalDurationMs).toBe(0);
  });
});
