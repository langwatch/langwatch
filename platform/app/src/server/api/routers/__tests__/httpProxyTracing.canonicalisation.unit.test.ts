/**
 * @vitest-environment node
 *
 * The agent-test trace, driven through the real ingest seam rather than a mock
 * of it: `createAgentTestTrace` used to dispatch the `recordSpan` command
 * itself, handing it the raw OTLP envelope. The command's id resolver is
 * `(d) => d.traceId` and the envelope carries the id at `d.span.traceId`, so
 * every agent-test event committed with an empty `AggregateId` and neither
 * aggregate-scoped fold could key a row — the trace existed as events and
 * appeared nowhere.
 *
 * Everything below the route is real: the collection service, the canonicalising
 * recorder the composition root wires, the pipeline and its folds. Only the app
 * accessor is stubbed, and its `traces.recordSpan` throws — reaching the command
 * from a route is the bug itself.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createCanonicalSpanRecorder } from "~/server/app-layer/traces/ingest/canonicalSpanRecorder";
import { createSpanDedupeService } from "~/server/app-layer/traces/span-dedupe.service";
import { TraceRequestCollectionService } from "~/server/app-layer/traces/trace-request-collection.service";
import { createTraceProcessingPipeline } from "~/server/event-sourcing/trace-processing";
import { createFakeClient } from "~/server/event-sourcing/trace-processing/__tests__/fixtures";
import type { CanonicalSpan } from "~/server/event-sourcing/trace-processing/schema";
import { traceSummariesTable } from "~/server/event-sourcing/trace-processing/table";
import { createAgentTestTrace } from "../httpProxyTracing";

const SPAN_RECEIVED = "lw.obs.trace.span_received";
const PROJECT_ID = "project-agent-test";

const { app, getAppStub } = vi.hoisted(() => {
  const app = { collection: null as unknown, directCommandDispatches: 0 };
  return {
    app,
    getAppStub: () => ({
      traces: {
        collection: app.collection,
        recordSpan: () => {
          app.directCommandDispatches += 1;
          throw new Error(
            "recordSpan was dispatched from the route with an OTLP envelope",
          );
        },
      },
    }),
  };
});

vi.mock("~/server/app-layer/app", () => ({ getApp: getAppStub }));
vi.mock("../../../app-layer/app", () => ({ getApp: getAppStub }));

const recorded: CanonicalSpan[] = [];

async function submitAgentTestTrace() {
  return await createAgentTestTrace({
    projectId: PROJECT_ID,
    agentId: "agent-123",
    userId: "user-456",
    testContext: {
      url: "https://api.example.com/test",
      method: "POST",
      has_auth: false,
    },
    requestBody: '{"question":"how are you?"}',
    requestHeaders: { "content-type": "application/json" },
    result: {
      success: true,
      response: { answer: "fine" },
      status: 200,
      statusText: "OK",
      duration: 42,
    },
  });
}

beforeAll(() => {
  app.collection = new TraceRequestCollectionService({
    dedup: createSpanDedupeService(null),
    recordSpan: createCanonicalSpanRecorder({
      recordSpan: async (span) => {
        recorded.push(span);
      },
    }),
  });
});

beforeEach(() => {
  recorded.length = 0;
  app.directCommandDispatches = 0;
});

describe("given an HTTP agent test that submits a trace", () => {
  describe("when the trace reaches the trace-processing pipeline", () => {
    /** @scenario The test span is recorded against the trace it belongs to */
    it("keys the recorded event on the trace the span belongs to", async () => {
      const { traceId } = await submitAgentTestTrace();
      const built = createTraceProcessingPipeline({
        client: createFakeClient(),
      });

      const aggregateId = built.aggregateIdFor(SPAN_RECEIVED, recorded[0]);

      expect(aggregateId).toBe(traceId);
      expect(aggregateId).toBeTruthy();
    });

    it("hands the command a canonical span, not the OTLP envelope", async () => {
      const { traceId } = await submitAgentTestTrace();
      const built = createTraceProcessingPipeline({
        client: createFakeClient(),
      });

      const span = recorded[0]!;

      expect(span.traceId).toBe(traceId);
      expect(span.tenantId).toBe(PROJECT_ID);
      expect(span.instrumentationScopeName).toBe("langwatch.agent_test");
      expect(span.startTimeUnixMs).toBeGreaterThan(0);
      expect(() => built.commands.recordSpan!.input.parse(span)).not.toThrow();
    });

    it("never dispatches the command from the route", async () => {
      await submitAgentTestTrace();

      expect(app.directCommandDispatches).toBe(0);
      expect(recorded).toHaveLength(1);
    });
  });

  describe("when the recorded event is folded", () => {
    it("writes the trace summary row the Traces page reads", async () => {
      const { traceId } = await submitAgentTestTrace();
      const client = createFakeClient();
      const built = createTraceProcessingPipeline({ client });

      const result = await built.folds.traceSummary!.apply({
        key: traceId,
        tenantId: PROJECT_ID,
        events: [{ type: SPAN_RECEIVED, data: recorded[0] }],
      });

      expect(result).toEqual({ events: 1 });
      const call = client.insertCalls[0];
      expect(call?.table).toBe(traceSummariesTable.name);
      expect(call?.rows[0]?.[(call?.columns ?? []).indexOf("TraceId")]).toBe(
        traceId,
      );
    });
  });
});
