import { describe, expect, it } from "vitest";
import { logRecord, logRecordAggregateId } from "../aggregate";
import { canonicalLogRecordSchema } from "../schema";

function fixtureRecord() {
  return canonicalLogRecordSchema.parse({
    tenantId: "project_test",
    organizationId: "organization_test",
    recordId: "a".repeat(64),
    resourceSchemaUrl: "",
    resourceAttributesJson: "[]",
    resourceAttributesFlatJson: "{}",
    resourceAttributeKeys: [],
    resourceDroppedAttributesCount: 0,
    scopeSchemaUrl: "",
    scopeName: "",
    scopeVersion: "",
    scopeAttributesJson: "[]",
    scopeAttributeKeys: [],
    scopeDroppedAttributesCount: 0,
    wireTraceId: "",
    wireSpanId: "",
    correlationTraceId: "",
    correlationSpanId: "",
    correlationSource: "none",
    timeUnixNano: "0",
    observedTimeUnixNano: "0",
    timeUnixMs: 0,
    severityNumber: 0,
    severityText: "",
    bodyType: "string",
    bodyJson: "{}",
    bodyText: "hello",
    attributesJson: "[]",
    attributesFlatJson: "{}",
    attributeKeys: [],
    droppedAttributesCount: 0,
    flags: 0,
    eventName: "",
    providerKind: "generic",
    providerEventKind: "",
    providerEventSequence: "",
    providerSessionId: "",
    providerConversationId: "",
    providerPromptId: "",
    piiRedactionLevel: "DISABLED",
    canonicalPayload: "{}",
    canonicalSizeBytes: 2,
    occurredAt: 0,
    acceptedAt: 0,
  });
}

describe("the log aggregate", () => {
  describe("given the aggregate is built", () => {
    it("derives one event type, qualified by the aggregate name", () => {
      expect([...logRecord.eventTypes]).toEqual(["log/recordReceived"]);
    });

    it("names the aggregate 'log', matching the persisted AggregateType already in event_log", () => {
      // migrations/00050_create_canonical_logs.sql keys `_size_bytes`'s
      // MATERIALIZED expression on `AggregateType IN ('metric', 'log')` — this
      // rewrite does not rename an identifier that is already persisted.
      expect(logRecord.name).toBe("log");
    });

    it("creates an event carrying the record as its payload, unchanged", () => {
      const record = fixtureRecord();
      const event = logRecord.events.recordReceived(record);
      expect(event).toEqual({ type: "log/recordReceived", data: record });
    });

    it("applies the event by adopting the record as the aggregate's state", () => {
      const record = fixtureRecord();
      const next = logRecord.apply(
        logRecord.init(),
        logRecord.events.recordReceived(record),
      );
      expect(next).toEqual(record);
    });

    it("starts from null state — a log record has no lifecycle before it arrives", () => {
      expect(logRecord.init()).toBeNull();
    });

    it("leaves state untouched for an event type it was not built with", () => {
      const state = logRecord.init();
      expect(
        logRecord.apply(state, { type: "log/somethingLater", data: {} }),
      ).toBe(state);
    });
  });

  describe("given the recordCanonicalLog command", () => {
    it("emits exactly the recordReceived event, carrying the input through unchanged", () => {
      const record = fixtureRecord();
      const emitted = logRecord.commands.recordCanonicalLog.handle(
        logRecord.init(),
        record,
        logRecord.events,
      );
      expect(emitted).toEqual([{ type: "log/recordReceived", data: record }]);
    });
  });

  describe("given a payload naming its own record id", () => {
    it("derives the aggregate id as the record's content hash", () => {
      expect(logRecordAggregateId({ recordId: "b".repeat(64) })).toBe(
        "b".repeat(64),
      );
    });

    /** @scenario A log record's aggregate id is its own content hash */
    it("gives two canonicalizations of the same wire record the same aggregate id", () => {
      const record = fixtureRecord();
      const aggregateId = logRecordAggregateId(record);
      expect(aggregateId).toBe(record.recordId);
      // A redelivery re-canonicalizes the same wire bytes into a record whose
      // recordId is unchanged (canonicalize.unit.test.ts covers the hashing
      // itself); the aggregate id tracks it exactly, with no derivation step
      // of its own that could disagree.
      const redelivered = fixtureRecord();
      expect(logRecordAggregateId(redelivered)).toBe(aggregateId);
    });
  });
});
