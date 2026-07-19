import { describe, expect, it } from "vitest";

import { createTenantId } from "~/server/event-sourcing";

import {
  LOG_RECORD_RECEIVED_EVENT_TYPE,
  LOG_RECORD_RECEIVED_EVENT_VERSION_LATEST,
  METRIC_RECORD_RECEIVED_EVENT_TYPE,
  METRIC_RECORD_RECEIVED_EVENT_VERSION_LATEST,
} from "../../schemas/constants";
import type {
  LogRecordReceivedEvent,
  MetricRecordReceivedEvent,
} from "../../schemas/events";
import { TraceSummaryFoldProjection } from "../traceSummary.foldProjection";
import { createInitState } from "./fixtures/trace-summary-test.fixtures";

function makeProjection() {
  return new TraceSummaryFoldProjection({
    store: { store: async () => {}, get: async () => null },
  });
}

function makeLogEvent({
  traceId,
  spanId,
}: {
  traceId: string;
  spanId: string;
}): LogRecordReceivedEvent {
  return {
    id: `evt-log-${traceId || "empty"}`,
    type: LOG_RECORD_RECEIVED_EVENT_TYPE,
    version: LOG_RECORD_RECEIVED_EVENT_VERSION_LATEST,
    aggregateType: "trace",
    aggregateId: traceId,
    tenantId: createTenantId("tenant-1"),
    createdAt: 1700000000000,
    occurredAt: 1700000000000,
    data: {
      traceId,
      spanId,
      timeUnixMs: 1700000000000,
      severityNumber: 9,
      severityText: "INFO",
      body: "test log",
      attributes: {},
      resourceAttributes: { "service.name": "claude-code" },
      scopeName: "test",
      scopeVersion: null,
      piiRedactionLevel: "ESSENTIAL",
    },
    metadata: {},
  };
}

function makeMetricEvent({
  traceId,
  spanId,
}: {
  traceId: string;
  spanId: string;
}): MetricRecordReceivedEvent {
  return {
    id: `evt-metric-${traceId || "empty"}`,
    type: METRIC_RECORD_RECEIVED_EVENT_TYPE,
    version: METRIC_RECORD_RECEIVED_EVENT_VERSION_LATEST,
    aggregateType: "trace",
    aggregateId: traceId,
    tenantId: createTenantId("tenant-1"),
    createdAt: 1700000000000,
    occurredAt: 1700000000000,
    data: {
      traceId,
      spanId,
      metricName: "claude_code.session.count",
      metricUnit: "{session}",
      metricType: "gauge",
      value: 1,
      timeUnixMs: 1700000000000,
      attributes: {},
      resourceAttributes: { "service.name": "claude-code" },
    },
    metadata: {},
  };
}

describe("TraceSummaryFoldProjection — empty-id skip guard", () => {
  describe("when a LogRecordReceivedEvent has no trace context", () => {
    /**
     * Logs persisted via the map projection still land in
     * stored_log_records, so users can query them directly. The fold
     * MUST NOT accumulate them under aggregateId="" — otherwise every
     * standalone log in the tenant folds into a single nameless ghost
     * trace_summary entry that grows unboundedly.
     */
    it("returns state unchanged so no ghost summary accumulates", () => {
      const projection = makeProjection();
      const state = createInitState();
      const before = JSON.stringify(state);

      const after = projection.handleTraceLogRecordReceived(
        makeLogEvent({ traceId: "", spanId: "" }),
        state,
      );

      expect(JSON.stringify(after)).toBe(before);
      expect(
        after.attributes["langwatch.reserved.log_record_count"],
      ).toBeUndefined();
    });
  });

  describe("when a LogRecordReceivedEvent has real trace context", () => {
    it("folds normally and bumps the log_record_count", () => {
      const projection = makeProjection();
      const state = createInitState();

      const after = projection.handleTraceLogRecordReceived(
        makeLogEvent({
          traceId: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
          spanId: "1122334455667788",
        }),
        state,
      );

      expect(after.attributes["langwatch.reserved.log_record_count"]).toBe("1");
    });
  });

  describe("when a MetricRecordReceivedEvent has no trace context", () => {
    it("returns state unchanged so no ghost summary accumulates", () => {
      const projection = makeProjection();
      const state = createInitState();
      const before = JSON.stringify(state);

      const after = projection.handleTraceMetricRecordReceived(
        makeMetricEvent({ traceId: "", spanId: "" }),
        state,
      );

      expect(JSON.stringify(after)).toBe(before);
      expect(
        after.attributes["langwatch.reserved.metric_record_count"],
      ).toBeUndefined();
    });
  });

  describe("when a MetricRecordReceivedEvent has real trace context", () => {
    it("folds normally and bumps the metric_record_count", () => {
      const projection = makeProjection();
      const state = createInitState();

      const after = projection.handleTraceMetricRecordReceived(
        makeMetricEvent({
          traceId: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
          spanId: "1122334455667788",
        }),
        state,
      );

      expect(after.attributes["langwatch.reserved.metric_record_count"]).toBe(
        "1",
      );
    });
  });
});
