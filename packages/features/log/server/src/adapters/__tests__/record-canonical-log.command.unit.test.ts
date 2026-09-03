import {
  CANONICAL_LOG_RECORD_RECEIVED_EVENT_TYPE,
  CANONICAL_LOG_RECORD_RECEIVED_EVENT_VERSION_LATEST,
  RECORD_CANONICAL_LOG_COMMAND_TYPE,
} from "@langwatch/log-contract";
import type { CanonicalLogRecord } from "@langwatch/log-contract";
import { describe, expect, it } from "vitest";
import { RecordCanonicalLogCommand } from "../log-processing.adapter";

const TENANT_ID = "project_record_canonical_log";
const RECORD_ID = "b".repeat(64);

/** A schema-valid canonical record; identity is what these tests read. */
function logRecord(): CanonicalLogRecord {
  return {
    tenantId: TENANT_ID,
    organizationId: "organization-1",
    recordId: RECORD_ID,
    resourceSchemaUrl: "",
    resourceAttributesJson: "[]",
    resourceAttributesFlatJson: "{}",
    resourceAttributeKeys: [],
    resourceDroppedAttributesCount: 0,
    scopeSchemaUrl: "",
    scopeName: "scope",
    scopeVersion: "",
    scopeAttributesJson: "[]",
    scopeAttributeKeys: [],
    scopeDroppedAttributesCount: 0,
    wireTraceId: "",
    wireSpanId: "",
    correlationTraceId: "",
    correlationSpanId: "",
    correlationSource: "none",
    timeUnixNano: "1",
    observedTimeUnixNano: "1",
    timeUnixMs: 1_800_000_000_000,
    severityNumber: 9,
    severityText: "INFO",
    bodyType: "string",
    bodyJson: '"body"',
    bodyText: "body",
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
    piiRedactionLevel: "STRICT",
    canonicalPayload: "{}",
    canonicalSizeBytes: 2,
    occurredAt: 1_800_000_000_000,
    acceptedAt: 1_800_000_000_000,
  };
}

function command() {
  return {
    type: RECORD_CANONICAL_LOG_COMMAND_TYPE,
    tenantId: TENANT_ID,
    data: logRecord(),
  } as Parameters<RecordCanonicalLogCommand["handle"]>[0];
}

describe("RecordCanonicalLogCommand", () => {
  describe("given a prepared canonical log record", () => {
    describe("when the command is handled", () => {
      /** @scenario "Valid OTLP logs become canonical durable events" */
      it("emits one record_received event on the log aggregate for that record", () => {
        const events = new RecordCanonicalLogCommand().handle(command());

        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
          type: CANONICAL_LOG_RECORD_RECEIVED_EVENT_TYPE,
          aggregateType: "log",
          aggregateId: RECORD_ID,
          tenantId: TENANT_ID,
        });
        expect(events[0]!.type).toBe("lw.obs.log.record_received");
        expect(events[0]!.data.recordId).toBe(RECORD_ID);
        expect(RecordCanonicalLogCommand.getAggregateId(logRecord())).toBe(RECORD_ID);
      });
    });

    describe("when the same command is handled a second time after a persistence failure", () => {
      /** @scenario "Canonical log identity and retries are stable" */
      it("mints the same record id, version, aggregate identity and tenant-scoped idempotency key", () => {
        const handler = new RecordCanonicalLogCommand();

        const first = handler.handle(command())[0]!;
        const second = handler.handle(command())[0]!;

        expect(second.data.recordId).toBe(first.data.recordId);
        expect(second.version).toBe(first.version);
        expect(second.version).toBe(CANONICAL_LOG_RECORD_RECEIVED_EVENT_VERSION_LATEST);
        expect(second.aggregateId).toBe(first.aggregateId);
        expect(second.aggregateType).toBe(first.aggregateType);
        expect(second.idempotencyKey).toBe(first.idempotencyKey);
        expect(second.idempotencyKey).toBe(`${TENANT_ID}:${RECORD_ID}`);
        expect(second.occurredAt).toBe(first.occurredAt);
      });

      /** @scenario "Canonical log identity and retries are stable" */
      it("keys the retry on the tenant, so another tenant's identical record is not deduplicated away", () => {
        const handler = new RecordCanonicalLogCommand();

        const ours = handler.handle(command())[0]!;
        const theirs = handler.handle({
          ...command(),
          tenantId: "project_someone_else",
        } as Parameters<RecordCanonicalLogCommand["handle"]>[0])[0]!;

        expect(theirs.idempotencyKey).not.toBe(ours.idempotencyKey);
        expect(theirs.idempotencyKey).toBe(`project_someone_else:${RECORD_ID}`);
      });
    });
  });
});
