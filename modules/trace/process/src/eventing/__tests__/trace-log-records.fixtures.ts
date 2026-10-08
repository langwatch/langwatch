import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import {
  createTenantId,
  defineAggregate,
  definePipeline,
  EventSourcing,
  InMemoryProcessStore,
} from "@langwatch/eventing";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import {
  CANONICAL_LOG_RECORD_RECEIVED_EVENT_TYPE,
  CANONICAL_LOG_RECORD_RECEIVED_EVENT_VERSION_LATEST,
  type CanonicalLogRecord,
  canonicalLogRecordReceivedEventSchema,
} from "@langwatch/log-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";

import { MemoryLogRecordStorageRepository } from "../../repositories/memory/memory.log-record-storage.repository.ts";
import { buildTraceLogRecordsPipeline } from "../trace-log-records.pipeline.ts";

/** A canonical log record as log's fact carries it; override what a scenario names. */
export function canonicalLogRecordFixture(
  overrides: Partial<CanonicalLogRecord> = {},
): CanonicalLogRecord {
  return {
    tenantId: "project-1",
    organizationId: "organization-1",
    recordId: "a".repeat(64),
    resourceSchemaUrl: "",
    resourceAttributesJson: "{}",
    resourceAttributesFlatJson: JSON.stringify({ "service.name": "claude-code" }),
    resourceAttributeKeys: ["service.name"],
    resourceDroppedAttributesCount: 0,
    scopeSchemaUrl: "",
    scopeName: "com.anthropic.claude_code",
    scopeVersion: "1.0.0",
    scopeAttributesJson: "{}",
    scopeAttributeKeys: [],
    scopeDroppedAttributesCount: 0,
    wireTraceId: "trace-1",
    wireSpanId: "span-1",
    correlationTraceId: "trace-1",
    correlationSpanId: "span-1",
    correlationSource: "wire",
    timeUnixNano: "1700000000000000000",
    observedTimeUnixNano: "1700000000000000000",
    timeUnixMs: 1_700_000_000_000,
    severityNumber: 9,
    severityText: "INFO",
    bodyType: "string",
    bodyJson: JSON.stringify("hello"),
    bodyText: "hello",
    attributesJson: "{}",
    attributesFlatJson: JSON.stringify({ "prompt.id": "prompt-1" }),
    attributeKeys: ["prompt.id"],
    droppedAttributesCount: 0,
    flags: 0,
    eventName: "claude_code.user_prompt",
    providerKind: "claude_code",
    providerEventKind: "user_prompt",
    providerEventSequence: "1",
    providerSessionId: "session-1",
    providerConversationId: "",
    providerPromptId: "prompt-1",
    piiRedactionLevel: "ESSENTIAL",
    canonicalPayload: "{}",
    canonicalSizeBytes: 2,
    occurredAt: 1_700_000_000_000,
    acceptedAt: 1_700_000_000_500,
    ...overrides,
  };
}

/** Log's pipeline as its contract names the fact. */
function logStandIn() {
  return definePipeline({ name: "log_stand_in", aggregate: defineAggregate({ type: "log" }) })
    .withEvents([canonicalLogRecordReceivedEventSchema])
    .build();
}

export function logRecordsHarness() {
  const repository = MemoryLogRecordStorageRepository.create();
  const eventing = new EventSourcing({
    eventStore: EventStoreMemory.createForTesting(),
    processStore: InMemoryProcessStore.createForTesting(),
  });
  const log = eventing.register(logStandIn());
  const host = buildTraceLogRecordsPipeline({
    repository,
    retention: createApiFixture<
      Pick<DataRetentionApi, "getPlatformDefaultRetentionDays" | "getResolvedForProject">
    >({
      getPlatformDefaultRetentionDays: () => 30,
      getResolvedForProject: async () => ({ traces: 400, scenarios: 400, experiments: 400 }),
    }),
  });
  eventing.register(host);
  const record = (data: CanonicalLogRecord, id: string) =>
    log.service.storeEvents(
      [
        {
          id,
          aggregateId: data.recordId,
          aggregateType: "log",
          tenantId: createTenantId(data.tenantId),
          type: CANONICAL_LOG_RECORD_RECEIVED_EVENT_TYPE,
          version: CANONICAL_LOG_RECORD_RECEIVED_EVENT_VERSION_LATEST,
          createdAt: data.acceptedAt,
          occurredAt: data.occurredAt,
          data,
        },
      ],
      { tenantId: createTenantId(data.tenantId) },
    );
  return { eventing, host, record, repository };
}
