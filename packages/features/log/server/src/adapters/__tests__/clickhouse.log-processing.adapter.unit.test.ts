import { describe, expect, it, vi } from "vitest";
import type { CanonicalLogRecord } from "@langwatch/log-contract";
import { ClickHouseLogProcessingAdapter } from "../clickhouse.log-processing.adapter";
import { ClickHouseCanonicalLogRecordAppendRepository } from "../../repositories/clickhouse/clickhouse.canonical-log-record-append.repository";
import type { LogClickHouseClient } from "../../repositories/clickhouse/clickhouse.canonical-log-record-append.repository";
import { ClickHouseCanonicalLogRecordRepository } from "../../repositories/clickhouse/clickhouse.canonical-log-record.repository";

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
    it("builds the log-processing pipeline from that client alone", () => {
      const pipeline = ClickHouseLogProcessingAdapter.create({
        resolveClient: async () => client(),
        defaultRetentionDays: 49,
        logCommandShardCount: 8,
      }).buildProcessing();

      expect(pipeline.metadata.name).toBe("log_processing");
      expect(pipeline.commands.map((command) => command.name)).toEqual(["recordLogRecord"]);
      expect([...pipeline.mapProjections.keys()]).toEqual(["canonicalLogStorage"]);
    });

    /** @scenario "The processing pipeline composes from one tenant-keyed client" */
    it("mounts the dispatch subscribers it is handed under their own names", () => {
      const pipeline = ClickHouseLogProcessingAdapter.create({
        resolveClient: async () => client(),
        defaultRetentionDays: 49,
        logCommandShardCount: 8,
      }).buildProcessing({
        subscribers: [
          {
            name: "codingAgentLogFactsDispatch",
            eventTypes: ["lw.obs.log.record_received"],
            handle: async () => undefined,
          },
        ],
      });

      expect([...pipeline.eventSubscribers.keys()]).toEqual(["codingAgentLogFactsDispatch"]);
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

  describe("given the port durable processing appends through", () => {
    /** @scenario "The append surface offers no read" */
    it("carries no trace-scoped read", () => {
      const appendOnly = ClickHouseCanonicalLogRecordAppendRepository.create({
        resolveClient: async () => client(),
        defaultRetentionDays: 49,
      });

      // Named against the object rather than the type, because the type is
      // what a `defaultReadLimit` reintroduced here would satisfy again
      // without anything failing.
      expect("getLogsByTraceId" in appendOnly).toBe(false);
    });
  });

  describe("given the full repository and the append-only one", () => {
    /** @scenario "Both graphs append through one implementation" */
    it("runs the same append path for both", async () => {
      const wideInsert = vi.fn<LogClickHouseClient["insert"]>(async () => undefined);
      const narrowInsert = vi.fn<LogClickHouseClient["insert"]>(async () => undefined);
      const one = sample();

      await ClickHouseCanonicalLogRecordRepository.create({
        resolveClient: async () => client({ insert: wideInsert }),
        defaultRetentionDays: 49,
        defaultReadLimit: 100,
      }).ensureLogRecord(one);
      await ClickHouseCanonicalLogRecordAppendRepository.create({
        resolveClient: async () => client({ insert: narrowInsert }),
        defaultRetentionDays: 49,
      }).ensureLogRecord(one);

      expect(narrowInsert.mock.calls.map(([call]) => call)).toEqual(
        wideInsert.mock.calls.map(([call]) => call),
      );
    });
  });
});
