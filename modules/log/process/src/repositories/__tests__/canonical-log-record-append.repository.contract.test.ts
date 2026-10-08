/**
 * @vitest-environment node
 * The canonical-log repository answers alike over its memory twin and its ClickHouse backend:
 * each batch handed to it is held, an empty one holds nothing.
 * Spec: modules/log/specs/log-processing.feature
 */
import type { CanonicalLogRecord } from "@langwatch/log-contract";
import { describe, expect, it } from "vitest";

import type { CanonicalLogRecordAppendRepository } from "../canonical-log-record-append.repository.ts";
import { ClickHouseCanonicalLogRecordAppendRepository } from "../clickhouse/clickhouse.canonical-log-record-append.repository.ts";
import { MemoryCanonicalLogRecordAppendRepository } from "../memory/memory.canonical-log-record-append.repository.ts";

type Backend = Readonly<{
  repository: CanonicalLogRecordAppendRepository;
  held: () => number;
}>;

function record(recordId: string): CanonicalLogRecord {
  return {
    tenantId: "project_test",
    organizationId: "organization_test",
    recordId,
    resourceSchemaUrl: "",
    resourceAttributesJson: "[]",
    resourceAttributesFlatJson: "{}",
    resourceAttributeKeys: [],
    resourceDroppedAttributesCount: 0,
    scopeSchemaUrl: "",
    scopeName: "scope",
    scopeVersion: "1",
    scopeAttributesJson: "[]",
    scopeAttributeKeys: [],
    scopeDroppedAttributesCount: 0,
    wireTraceId: "",
    wireSpanId: "",
    correlationTraceId: "b".repeat(32),
    correlationSpanId: "c".repeat(16),
    correlationSource: "claude_synthesized",
    timeUnixNano: "1700000000000000000",
    observedTimeUnixNano: "0",
    timeUnixMs: 1_700_000_000_000,
    severityNumber: 9,
    severityText: "INFO",
    bodyType: "string",
    bodyJson: '{"type":"string","value":"hello"}',
    bodyText: "hello",
    attributesJson: "[]",
    attributesFlatJson: "{}",
    attributeKeys: [],
    droppedAttributesCount: 0,
    flags: 0,
    eventName: "api_request",
    providerKind: "claude_code",
    providerEventKind: "model",
    providerEventSequence: "1",
    providerSessionId: "session",
    providerConversationId: "",
    providerPromptId: "prompt",
    piiRedactionLevel: "ESSENTIAL",
    canonicalPayload: "{}",
    canonicalSizeBytes: 2,
    occurredAt: 1_700_000_000_000,
    acceptedAt: 1_800_000_000_000,
  };
}

const FIRST = "a".repeat(64);
const SECOND = "d".repeat(64);

function contractCases(makeBackend: () => Backend): void {
  it("holds nothing for an empty batch", async () => {
    const backend = makeBackend();

    await backend.repository.ensureLogRecords([]);

    expect(backend.held()).toBe(0);
  });

  it("holds the one record it was given", async () => {
    const backend = makeBackend();

    await backend.repository.ensureLogRecord(record(FIRST));

    expect(backend.held()).toBe(1);
  });

  it("holds every record of a batch", async () => {
    const backend = makeBackend();

    await backend.repository.ensureLogRecords([record(FIRST), record(SECOND)]);

    expect(backend.held()).toBe(2);
  });
}

describe("given the canonical-log memory repository", () => {
  contractCases(() => {
    const repository = MemoryCanonicalLogRecordAppendRepository.create();
    return { repository, held: () => repository.records().length };
  });
});

describe("given the canonical-log ClickHouse repository over a recording client", () => {
  contractCases(() => {
    let rows = 0;
    const repository = ClickHouseCanonicalLogRecordAppendRepository.create({
      defaultRetentionDays: 30,
      resolveClient: async () => ({
        insert: async ({ table, values }) => {
          if (table === "log_records") rows += values.length;
        },
        query: async () => ({ json: async () => [] }),
      }),
    });
    return { repository, held: () => rows };
  });
});
