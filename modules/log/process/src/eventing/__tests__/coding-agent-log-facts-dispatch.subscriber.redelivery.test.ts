import { createApiFixture } from "@langwatch/api-fixture";
import type { CodingAgentApi } from "@langwatch/coding-agent-contract";
import { createTenantId } from "@langwatch/eventing";
import {
  CANONICAL_LOG_RECORD_RECEIVED_EVENT_TYPE,
  type CanonicalLogRecord,
  type LogProcessingEvent,
} from "@langwatch/log-contract";
import { describe, expect, it } from "vitest";

import { createCodingAgentLogFactsDispatchSubscriber } from "../coding-agent-log-facts-dispatch.subscriber.ts";

const RECORD: CanonicalLogRecord = {
  tenantId: "tenant-1",
  organizationId: "organization-1",
  recordId: "a".repeat(64),
  resourceSchemaUrl: "",
  resourceAttributesJson: "[]",
  resourceAttributesFlatJson: "{}",
  resourceAttributeKeys: [],
  resourceDroppedAttributesCount: 0,
  scopeSchemaUrl: "",
  scopeName: "com.anthropic.claude_code.events",
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
  timeUnixMs: 1_500,
  severityNumber: 9,
  severityText: "INFO",
  bodyType: "empty",
  bodyJson: "null",
  bodyText: null,
  attributesJson: "[]",
  attributesFlatJson: JSON.stringify({ "event.name": "user_prompt", "session.id": "sess-1" }),
  attributeKeys: [],
  droppedAttributesCount: 0,
  flags: 0,
  eventName: "",
  providerKind: "claude_code",
  providerEventKind: "",
  providerEventSequence: "",
  providerSessionId: "",
  providerConversationId: "",
  providerPromptId: "",
  piiRedactionLevel: "STRICT",
  canonicalPayload: "{}",
  canonicalSizeBytes: 2,
  occurredAt: 1_500,
  acceptedAt: 1_500,
};

function receivedEvent(record: CanonicalLogRecord): LogProcessingEvent {
  return {
    id: `event-${record.recordId}`,
    aggregateId: record.recordId,
    aggregateType: "log",
    tenantId: createTenantId(record.tenantId),
    createdAt: 1_500,
    occurredAt: 1_500,
    type: CANONICAL_LOG_RECORD_RECEIVED_EVENT_TYPE,
    version: "2025-01-01",
    data: record,
  };
}

function subscriber() {
  const forwarded: CanonicalLogRecord[] = [];
  const definition = createCodingAgentLogFactsDispatchSubscriber({
    codingAgents: createApiFixture<CodingAgentApi>({
      contributeReceivedLogRecord: async (record) => {
        forwarded.push(record);
      },
    }),
  });
  return { definition, forwarded };
}

function deduplicationIdOf(
  definition: ReturnType<typeof createCodingAgentLogFactsDispatchSubscriber>,
  event: LogProcessingEvent,
): string {
  const strategy = definition.options?.deduplication;
  if (strategy === undefined || strategy === "aggregate") {
    throw new Error("the dispatch declares its own deduplication id");
  }
  return strategy.makeId(event);
}

const context = { tenantId: "tenant-1", aggregateId: RECORD.recordId };

describe("codingAgentLogFactsDispatch", () => {
  describe("when a received log record is redelivered", () => {
    /** @scenario "Each received log record is forwarded to coding-agent once per record" */
    it("forwards the same record each time under one deduplication identity", async () => {
      const { definition, forwarded } = subscriber();
      const event = receivedEvent(RECORD);

      await definition.handle(event, context);
      await definition.handle(event, context);

      expect(forwarded).toEqual([RECORD, RECORD]);
      expect(deduplicationIdOf(definition, event)).toBe(
        deduplicationIdOf(definition, { ...event, id: "event-redelivered" }),
      );
    });

    it("keys two records apart", () => {
      const { definition } = subscriber();
      const other = receivedEvent({ ...RECORD, recordId: "b".repeat(64) });

      expect(deduplicationIdOf(definition, receivedEvent(RECORD))).not.toBe(
        deduplicationIdOf(definition, other),
      );
    });
  });
});
