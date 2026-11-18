import type { CanonicalLogRecord } from "@langwatch/log-contract";
import { describe, expect, it, vi } from "vitest";

import {
  ClickHouseCanonicalLogRecordAppendRepository,
  type LogClickHouseClient,
} from "../clickhouse.canonical-log-record-append.repository.ts";

function createRepository(resolveClient: () => Promise<LogClickHouseClient>) {
  return ClickHouseCanonicalLogRecordAppendRepository.create({
    clickhouse: { read: async () => ({ rows: [] }) },
    resolveClient,
    defaultRetentionDays: 30,
  });
}

function clientWithInsert(insert: LogClickHouseClient["insert"]): LogClickHouseClient {
  return {
    insert,
  };
}

function record(): CanonicalLogRecord {
  return {
    tenantId: "project_test",
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

describe("ClickHouseCanonicalLogRecordAppendRepository", () => {
  /** @scenario "Valid OTLP logs become canonical durable events" */
  it("writes the authoritative row before the payload-free usage estimate", async () => {
    const insert = vi.fn<(args: { table: string; values: unknown[] }) => Promise<void>>(
      async () => undefined,
    );
    const repository = createRepository(async () => clientWithInsert(insert));

    await repository.ensureLogRecord(record(), 49);

    expect(insert.mock.calls.map((call) => call[0].table)).toEqual([
      "log_records",
      "log_usage_estimates",
    ]);
    const raw = insert.mock.calls[0]![0].values[0] as Record<string, unknown>;
    expect(raw).toMatchObject({
      TenantId: "project_test",
      RecordId: "a".repeat(64),
      CanonicalPayload: "{}",
      _retention_days: 49,
      _size_bytes: 2,
    });
    expect(raw).not.toHaveProperty("OrganizationId");
    const usage = insert.mock.calls[1]![0].values[0] as Record<string, unknown>;
    expect(usage).toMatchObject({
      OrganizationId: "organization_test",
      TenantId: "project_test",
      RecordId: "a".repeat(64),
      CanonicalSourceBytes: 2,
    });
    expect(usage).not.toHaveProperty("CanonicalPayload");
    expect(usage).not.toHaveProperty("BodyJson");
  });

  describe("given a coding-agent log record", () => {
    it("stamps it on the caller's retention like any other", async () => {
      const insert = vi.fn<(args: { table: string; values: unknown[] }) => Promise<void>>(
        async () => undefined,
      );
      const repository = createRepository(async () => clientWithInsert(insert));

      await repository.ensureLogRecord(record(), 49);

      // A claude_code record once expired after a day, because a subscriber
      // copied it into spans and the row was disposable once converted. That
      // converter is retired (ADR-056): the record IS the Terminal
      // transcript's content, so nothing here shortens its retention — it
      // rides the caller's, exactly like every other log.
      const raw = insert.mock.calls[0]![0].values[0] as Record<string, unknown>;
      expect(raw._retention_days).toBe(49);
    });
  });

  it("writes a same-tenant batch with two ClickHouse inserts total", async () => {
    const insert = vi.fn<(args: { table: string; values: unknown[] }) => Promise<void>>(
      async () => undefined,
    );
    const repository = createRepository(async () => clientWithInsert(insert));
    const second = {
      ...record(),
      recordId: "d".repeat(64),
    };

    await repository.ensureLogRecords([record(), second], 49);

    expect(insert).toHaveBeenCalledTimes(2);
    expect(insert.mock.calls[0]![0].values).toHaveLength(2);
    expect(insert.mock.calls[1]![0].values).toHaveLength(2);
  });
});

describe("ClickHouseCanonicalLogRecordAppendRepository.storedBytesRead", () => {
  it("sums its one tenant's stored bytes under the meter's thread and time caps", () => {
    const statement = ClickHouseCanonicalLogRecordAppendRepository.storedBytesRead({
      tenantId: "project_1",
    });

    expect(statement.identity).toBe("reader");
    expect(statement.kind).toBe("tenant");
    expect(statement.tenantId).toBe("project_1");
    expect(statement.settings.SQL_langwatch_tenant_ids).toBe("project_1");
    expect(statement.sql).toContain("FROM log_records");
    expect(statement.sql).toContain("sum(_size_bytes)");
    expect(statement.sql).toContain("SETTINGS max_threads = 2, max_execution_time = 45");
  });
});

describe("ClickHouseCanonicalLogRecordAppendRepository.storedBytesRead before a cutoff", () => {
  const beforeMs = Date.UTC(2026, 7, 1);

  /** @scenario "Log's stored bytes before a cutoff count only rows whose partition time is earlier" */
  it("keeps only rows whose `TimeUnixMs` is before the cutoff", () => {
    const statement = ClickHouseCanonicalLogRecordAppendRepository.storedBytesRead({
      tenantId: "project_1",
      beforeMs: beforeMs,
    });

    expect(statement.sql).toMatch(/TimeUnixMs\)? < /);
    expect(Object.values(statement.params)).toContain(beforeMs);
  });

  it("filters on no time without a cutoff", () => {
    expect(
      ClickHouseCanonicalLogRecordAppendRepository.storedBytesRead({ tenantId: "project_1" }).sql,
    ).not.toMatch(/TimeUnixMs\)? < /);
  });
});
