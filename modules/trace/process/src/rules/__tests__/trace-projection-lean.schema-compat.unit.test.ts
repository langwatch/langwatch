import { createTenantId } from "@langwatch/eventing";
import {
  LOG_RECORD_RECEIVED_EVENT_TYPE,
  LOG_RECORD_RECEIVED_EVENT_VERSION_LATEST,
  logRecordReceivedEventSchema,
  SPAN_RECEIVED_EVENT_TYPE,
  SPAN_RECEIVED_EVENT_VERSION_LATEST,
  spanReceivedEventSchema,
} from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { leanForProjection } from "../trace-projection-lean.rules.ts";

const LARGE_VALUE = "x".repeat(100 * 1024);

const BASE_EVENT_FIELDS = {
  id: "evt-001",
  aggregateId: "trace-aaa",
  aggregateType: "trace" as const,
  tenantId: createTenantId("tenant-001"),
  createdAt: 1700000000000,
  occurredAt: 1700000000000,
};

const spanReceived = spanReceivedEventSchema.parse({
  ...BASE_EVENT_FIELDS,
  type: SPAN_RECEIVED_EVENT_TYPE,
  version: SPAN_RECEIVED_EVENT_VERSION_LATEST,
  data: {
    span: {
      traceId: "aaaaaaaaaaaaaaaa",
      spanId: "bbbbbbbbbbbbbbbb",
      name: "test-span",
      kind: 1,
      startTimeUnixNano: "1700000000000000000",
      endTimeUnixNano: "1700000001000000000",
      attributes: [
        { key: "langwatch.input", value: { stringValue: LARGE_VALUE } },
        { key: "langwatch.output", value: { stringValue: LARGE_VALUE } },
        { key: "gen_ai.prompt", value: { stringValue: LARGE_VALUE } },
      ],
      events: [],
      links: [],
      status: { code: 1, message: null },
      droppedAttributesCount: 0,
      droppedEventsCount: 0,
      droppedLinksCount: 0,
    },
    resource: null,
    instrumentationScope: null,
    piiRedactionLevel: "DISABLED",
  },
  metadata: { spanId: "bbbbbbbbbbbbbbbb", traceId: "aaaaaaaaaaaaaaaa" },
});

const logRecordReceived = logRecordReceivedEventSchema.parse({
  ...BASE_EVENT_FIELDS,
  type: LOG_RECORD_RECEIVED_EVENT_TYPE,
  version: LOG_RECORD_RECEIVED_EVENT_VERSION_LATEST,
  data: {
    traceId: "aaaaaaaaaaaaaaaa",
    spanId: "bbbbbbbbbbbbbbbb",
    timeUnixMs: 1700000000000,
    severityNumber: 9,
    severityText: "INFO",
    body: LARGE_VALUE,
    attributes: {},
    resourceAttributes: {},
    scopeName: "test",
    scopeVersion: null,
    piiRedactionLevel: "DISABLED",
  },
  metadata: { spanId: "bbbbbbbbbbbbbbbb", traceId: "aaaaaaaaaaaaaaaa" },
});

/** Queued events parse with their contract schema at dispatch (ARCHITECTURE §9), leaned or not. */
describe("an event leaned for projection", () => {
  describe("given a span whose IO attributes were rewritten to previews", () => {
    it("still parses with the span-received contract schema", () => {
      const leaned = leanForProjection(spanReceived);

      expect(leaned).not.toEqual(spanReceived);
      expect(() => spanReceivedEventSchema.parse(leaned)).not.toThrow();
    });
  });

  describe("given a log record whose body was rewritten to a preview", () => {
    it("still parses with the log-record-received contract schema", () => {
      const leaned = leanForProjection(logRecordReceived);

      expect(leaned).not.toEqual(logRecordReceived);
      expect(() => logRecordReceivedEventSchema.parse(leaned)).not.toThrow();
    });
  });
});
