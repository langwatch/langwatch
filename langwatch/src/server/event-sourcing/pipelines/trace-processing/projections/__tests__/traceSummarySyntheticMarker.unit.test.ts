/**
 * Fold-projection carry of the "grouped by LangWatch" trace marker.
 *
 * When an emitter ships log records with no trace context of their own, the
 * ingestion path mints a stable trace id and stamps
 * `langwatch.trace.synthetic` + `langwatch.trace.derived_from` on the record.
 * The trace-summary read path exposes the whole attribute map to the drawer,
 * so the fold only has to carry those markers onto `state.attributes` for the
 * UI to show the badge.
 *
 * Guard: the per-record SPAN-level marker (`langwatch.span.synthetic`) must
 * NEVER surface as the trace-level marker — a real trace can hold a single
 * context-less record whose span id we minted, and the trace stays real.
 */
import { describe, expect, it } from "vitest";

import { createTenantId } from "~/server/event-sourcing";

import {
  LOG_RECORD_RECEIVED_EVENT_TYPE,
  LOG_RECORD_RECEIVED_EVENT_VERSION_LATEST,
} from "../../schemas/constants";
import type { LogRecordReceivedEvent } from "../../schemas/events";
import { TraceSummaryFoldProjection } from "../traceSummary.foldProjection";
import { createInitState } from "./fixtures/trace-summary-test.fixtures";

function makeProjection() {
  return new TraceSummaryFoldProjection({
    store: { store: async () => {}, get: async () => null },
  });
}

function makeLogEvent(attrs: Record<string, string>): LogRecordReceivedEvent {
  return {
    id: "evt-log",
    type: LOG_RECORD_RECEIVED_EVENT_TYPE,
    version: LOG_RECORD_RECEIVED_EVENT_VERSION_LATEST,
    aggregateType: "trace",
    aggregateId: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
    tenantId: createTenantId("tenant-1"),
    createdAt: 1700000000000,
    occurredAt: 1700000000000,
    data: {
      traceId: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
      spanId: "1122334455667788",
      timeUnixMs: 1700000000000,
      severityNumber: 9,
      severityText: "INFO",
      body: "log",
      attributes: attrs,
      resourceAttributes: { "service.name": "claude-code" },
      scopeName: "com.anthropic.claude_code.events",
      scopeVersion: "2.1.162",
      piiRedactionLevel: "ESSENTIAL",
    },
    metadata: {},
  };
}

describe("TraceSummaryFoldProjection — synthetic trace marker carry", () => {
  describe("when a log record carries the trace-level synthetic marker", () => {
    it("carries langwatch.trace.synthetic onto the trace attribute map", () => {
      const projection = makeProjection();
      const after = projection.handleTraceLogRecordReceived(
        makeLogEvent({
          "event.name": "user_prompt",
          "session.id": "s",
          "langwatch.trace.synthetic": "true",
          "langwatch.trace.derived_from": "session.id",
        }),
        createInitState(),
      );

      expect(after.attributes["langwatch.trace.synthetic"]).toBe("true");
    });

    it("carries the derived_from key so the badge can name the grouping key", () => {
      const projection = makeProjection();
      const after = projection.handleTraceLogRecordReceived(
        makeLogEvent({
          "session.id": "s",
          "langwatch.trace.synthetic": "true",
          "langwatch.trace.derived_from": "session.id",
        }),
        createInitState(),
      );

      expect(after.attributes["langwatch.trace.derived_from"]).toBe(
        "session.id",
      );
    });

    it("omits derived_from when the ingestion path could not name a key", () => {
      const projection = makeProjection();
      const after = projection.handleTraceLogRecordReceived(
        makeLogEvent({
          "session.id": "s",
          "langwatch.trace.synthetic": "true",
          "langwatch.trace.derived_from": "",
        }),
        createInitState(),
      );

      expect(after.attributes["langwatch.trace.synthetic"]).toBe("true");
      expect(
        after.attributes["langwatch.trace.derived_from"],
      ).toBeUndefined();
    });
  });

  describe("when a log record carries only the SPAN-level synthetic marker", () => {
    it("does NOT surface a trace-level synthetic marker (real trace stays real)", () => {
      const projection = makeProjection();
      const after = projection.handleTraceLogRecordReceived(
        makeLogEvent({
          "event.name": "user_prompt",
          "session.id": "s",
          "langwatch.span.synthetic": "true",
        }),
        createInitState(),
      );

      expect(after.attributes["langwatch.trace.synthetic"]).toBeUndefined();
      expect(
        after.attributes["langwatch.trace.derived_from"],
      ).toBeUndefined();
    });
  });

  describe("when an ordinary log record carries no synthetic marker", () => {
    it("leaves the trace attribute map free of any synthetic marker", () => {
      const projection = makeProjection();
      const after = projection.handleTraceLogRecordReceived(
        makeLogEvent({ "event.name": "user_prompt", "session.id": "s" }),
        createInitState(),
      );

      expect(after.attributes["langwatch.trace.synthetic"]).toBeUndefined();
    });
  });
});
