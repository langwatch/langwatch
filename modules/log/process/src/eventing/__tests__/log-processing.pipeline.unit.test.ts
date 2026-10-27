import type { CanonicalLogRecord } from "@langwatch/log-contract";
import { describe, expect, it, vi } from "vitest";

import {
  ClickHouseCanonicalLogRecordAppendRepository,
  type LogClickHouseClient,
} from "../../repositories/clickhouse/clickhouse.canonical-log-record-append.repository.ts";
import { LogProcessingAdapter } from "../log.pipeline.ts";

function client(overrides: Partial<LogClickHouseClient> = {}): LogClickHouseClient {
  return {
    insert: async () => undefined,
    query: async () => ({ json: async () => [] }),
    ...overrides,
  };
}

function sample(): CanonicalLogRecord {
  return {
    tenantId: "project_alpha",
    organizationId: "organization_test",
    recordId: "a".repeat(64),
    resourceSchemaUrl: "",
    resourceAttributesJson: "[]",
    resourceAttributesFlatJson: "{}",
    resourceAttributeKeys: [],
    resourceDroppedAttributesCount: 0,
    scopeSchemaUrl: "",
    scopeName: "com.anthropic.claude_code.events",
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
    attributesFlatJson: '{"event.name":"api_request"}',
    attributeKeys: ["event.name"],
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

describe("ClickHouseLogProcessingAdapter", () => {
  describe("given a process holding only a tenant-keyed ClickHouse client", () => {
    /** @scenario "The processing pipeline composes from one tenant-keyed client" */
    /** @scenario "Valid OTLP logs become canonical durable events" */
    it("builds the log-processing pipeline from that client alone", () => {
      const pipeline = LogProcessingAdapter.create({
        repository: ClickHouseCanonicalLogRecordAppendRepository.create({
          resolveClient: async () => client(),
          defaultRetentionDays: 49,
        }),
        defaultRetentionDays: 49,
        logCommandShardCount: 8,
      }).build();

      expect(pipeline.metadata.name).toBe("log_processing");
      expect(pipeline.commands.map((command) => command.definition.name)).toEqual([
        "recordLogRecord",
      ]);
      expect([...pipeline.mapProjections.keys()]).toEqual(["canonicalLogStorage"]);
    });

    /** @scenario "The processing pipeline composes from one tenant-keyed client" */
    it("appends through the tenant the record names", async () => {
      const insert = vi.fn<LogClickHouseClient["insert"]>(async () => undefined);
      const resolveClient = vi.fn(async () => client({ insert }));

      await ClickHouseCanonicalLogRecordAppendRepository.create({
        resolveClient,
        defaultRetentionDays: 49,
      }).ensureLogRecord(sample());

      expect(resolveClient).toHaveBeenCalledWith("project_alpha");
      expect(insert.mock.calls.map(([call]) => call.table)).toEqual([
        "log_records",
        "log_usage_estimates",
      ]);
    });
  });
});
