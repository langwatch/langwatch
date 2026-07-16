import { describe, expect, it } from "vitest";
import { createTenantId } from "~/server/event-sourcing";
import {
  LOG_RECORD_RECEIVED_EVENT_TYPE,
  LOG_RECORD_RECEIVED_EVENT_VERSION_LATEST,
  METRIC_DATA_POINT_CORRELATED_EVENT_TYPE,
  METRIC_DATA_POINT_CORRELATED_EVENT_VERSION_LATEST,
} from "../../schemas/constants";
import type {
  LogRecordReceivedEvent,
  MetricDataPointCorrelatedEvent,
} from "../../schemas/events";
import { TraceSummaryFoldProjection } from "../traceSummary.foldProjection";
import { createInitState } from "./fixtures/trace-summary-test.fixtures";

function makeProjection() {
  return new TraceSummaryFoldProjection({
    store: { store: async () => {}, get: async () => null },
  });
}

function makeLogEvent(traceId: string, spanId: string): LogRecordReceivedEvent {
  return {
    id: "evt-log",
    type: LOG_RECORD_RECEIVED_EVENT_TYPE,
    version: LOG_RECORD_RECEIVED_EVENT_VERSION_LATEST,
    aggregateType: "trace",
    aggregateId: traceId,
    tenantId: createTenantId("tenant-1"),
    createdAt: 1_700_000_000_000,
    occurredAt: 1_700_000_000_000,
    data: {
      traceId,
      spanId,
      timeUnixMs: 1_700_000_000_000,
      severityNumber: 9,
      severityText: "INFO",
      body: "test log",
      attributes: {},
      resourceAttributes: {},
      scopeName: "test",
      scopeVersion: null,
      piiRedactionLevel: "ESSENTIAL",
    },
    metadata: {},
  };
}

function makeCorrelationEvent(): MetricDataPointCorrelatedEvent {
  const traceId = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6";
  return {
    id: "evt-metric-correlation",
    type: METRIC_DATA_POINT_CORRELATED_EVENT_TYPE,
    version: METRIC_DATA_POINT_CORRELATED_EVENT_VERSION_LATEST,
    aggregateType: "trace",
    aggregateId: traceId,
    tenantId: createTenantId("tenant-1"),
    createdAt: 1_700_000_000_000,
    occurredAt: 1_700_000_000_000,
    data: {
      traceId,
      spanId: "1122334455667788",
      pointId: "a".repeat(64),
      seriesId: "b".repeat(64),
      metricName: "gen_ai.server.time_to_first_token",
      metricUnit: "s",
      metricKind: "histogram",
      exemplarValue: 0.25,
      exemplarTimeUnixMs: 1_700_000_000_000,
    },
    metadata: {},
  };
}

describe("TraceSummaryFoldProjection context guards", () => {
  it("ignores context-free logs so no empty trace aggregate grows", () => {
    const state = createInitState();
    const after = makeProjection().handleTraceLogRecordReceived(
      makeLogEvent("", ""),
      state,
    );
    expect(after).toBe(state);
  });

  it("folds only the separately validated metric correlation event", () => {
    const after = makeProjection().handleTraceMetricDataPointCorrelated(
      makeCorrelationEvent(),
      createInitState(),
    );
    expect(after.timeToFirstTokenMs).toBe(250);
    expect(after.attributes["langwatch.reserved.metric_record_count"]).toBe(
      "1",
    );
  });
});
