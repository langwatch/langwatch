/**
 * @vitest-environment node
 * @see modules/trace/specs/trace-failed-fact.feature
 */
import { createTenantId } from "@langwatch/eventing";
import type { TraceSummaryData } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { TraceCanonicalisationService } from "../../features/derivation/services/trace-canonicalisation.service.ts";
import {
  createTraceFailedHandler,
  isNewlyFailedTrace,
  TRACE_FAILED_DEDUP,
  TRACE_FAILED_WINDOW_MS,
} from "../trace-failed.subscriber.ts";
import { RecordTraceFailedCommand } from "../trace-project-milestones.commands.ts";
import {
  RECORD_TRACE_FAILED_COMMAND_TYPE,
  type RecordTraceFailedCommandData,
} from "../trace-project-milestones.events.ts";
import { TraceSummaryFoldProjection } from "../trace-summary.projection.ts";
import {
  createInitState,
  createSpanReceivedEvent,
  createTestRuntime,
  type TestSpanReceivedEventOptions,
} from "./trace-summary-test.fixtures.ts";

const NOW = Date.UTC(2026, 10, 20, 12);
const TRACE_ID = "aaaa0000000000000000000000000001";

function foldSpans(spans: readonly TestSpanReceivedEventOptions[]): TraceSummaryData {
  const projection = TraceSummaryFoldProjection.create({
    store: { store: async () => {}, get: async () => ({ kind: "empty" as const }) },
    traceCanonicalisation: TraceCanonicalisationService.create(),
    runtime: createTestRuntime(),
  });
  return spans.reduce<TraceSummaryData>(
    (state, span) =>
      projection.apply(
        state,
        createSpanReceivedEvent({ traceId: TRACE_ID, occurredAt: NOW, ...span }),
      ),
    { ...createInitState(), createdAt: NOW },
  );
}

const root = { spanId: "bbbb000000000001", parentSpanId: null, statusCode: 1 as const };
const child = { spanId: "bbbb000000000002", parentSpanId: "bbbb000000000001" };

describe("isNewlyFailedTrace()", () => {
  /** @scenario "A child span's error makes the trace failed and records trace_failed" */
  it("counts a trace failed by a child span's error status, as trace's own rule does", () => {
    const state = foldSpans([root, { ...child, statusCode: 2 }]);

    expect(state.containsErrorStatus).toBe(true);
    expect(isNewlyFailedTrace({ event: { occurredAt: NOW }, state, now: NOW })).toBe(true);
  });

  /** @scenario "A trace without an error records nothing" */
  it("does not count a trace whose spans all succeeded", () => {
    const state = foldSpans([root, { ...child, statusCode: 1 }]);

    expect(isNewlyFailedTrace({ event: { occurredAt: NOW }, state, now: NOW })).toBe(false);
  });

  /** @scenario "A span outside the hour records nothing" */
  it("does not count a span past the hour of its trace's first span, or of its own append", () => {
    const state = { containsErrorStatus: true, createdAt: NOW };
    const late = NOW + TRACE_FAILED_WINDOW_MS;

    expect(isNewlyFailedTrace({ event: { occurredAt: NOW }, state, now: NOW + 1 })).toBe(true);
    expect(isNewlyFailedTrace({ event: { occurredAt: late }, state, now: late })).toBe(false);
    expect(isNewlyFailedTrace({ event: { occurredAt: NOW }, state, now: late })).toBe(false);
  });
});

describe("the trace_failed subscriber's deduplication", () => {
  /** @scenario "Later spans of a failed trace record nothing more" */
  it("keys every span of a trace alike and holds the key past the window", () => {
    const span = (aggregateId: string) => ({ tenantId: createTenantId("project-1"), aggregateId });

    expect(TRACE_FAILED_DEDUP.makeId(span("trace-1"))).toBe(
      TRACE_FAILED_DEDUP.makeId(span("trace-1")),
    );
    expect(TRACE_FAILED_DEDUP.makeId(span("trace-2"))).not.toBe(
      TRACE_FAILED_DEDUP.makeId(span("trace-1")),
    );
    expect(TRACE_FAILED_DEDUP).toMatchObject({
      extend: false,
      replace: false,
      shouldSurviveDispatch: true,
    });
    expect(TRACE_FAILED_DEDUP.ttlMs).toBeGreaterThanOrEqual(2 * TRACE_FAILED_WINDOW_MS);
  });
});

describe("createTraceFailedHandler()", () => {
  /** @scenario "A child span's error makes the trace failed and records trace_failed" */
  it("records trace_failed with the project, trace, failing span's time and origin", async () => {
    const recorded: RecordTraceFailedCommandData[] = [];
    const handler = createTraceFailedHandler({
      milestones: {
        recordTraceFailed: (data) => {
          recorded.push(data);
          return Promise.resolve();
        },
      },
    });
    const state = {
      ...createInitState(),
      containsErrorStatus: true,
      attributes: { "langwatch.origin": "application" },
    };

    await handler(createSpanReceivedEvent({ tenantId: "project-1", occurredAt: NOW }), {
      tenantId: "project-1",
      aggregateId: TRACE_ID,
      state,
    });

    expect(recorded).toEqual([
      {
        tenantId: "project-1",
        projectId: "project-1",
        traceId: TRACE_ID,
        occurredAt: NOW,
        origin: "application",
      },
    ]);
  });
});

describe("RecordTraceFailedCommand", () => {
  const failed = (traceId: string): RecordTraceFailedCommandData => ({
    tenantId: "project-1",
    projectId: "project-1",
    traceId,
    occurredAt: NOW,
  });
  const recordedOf = (payload: RecordTraceFailedCommandData) =>
    new RecordTraceFailedCommand().handle({
      tenantId: createTenantId(payload.tenantId),
      aggregateId: RecordTraceFailedCommand.getAggregateId(payload),
      type: RECORD_TRACE_FAILED_COMMAND_TYPE,
      data: payload,
    });

  /** @scenario "The trace_failed fact is keyed by its project and trace" */
  it("keys each fact by its project and trace, a resend by the same idempotency key", () => {
    const [first] = recordedOf(failed("trace-1"));
    const [second] = recordedOf(failed("trace-2"));
    const [resent] = recordedOf(failed("trace-1"));

    expect(first?.aggregateId).toBe("project-1:trace-1");
    expect(second?.aggregateId).toBe("project-1:trace-2");
    expect(resent?.idempotencyKey).toBe(first?.idempotencyKey);
    expect(second?.idempotencyKey).not.toBe(first?.idempotencyKey);
  });
});
