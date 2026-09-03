import { describe, expect, it, vi } from "vitest";
import type { CanonicalLogRecord } from "@langwatch/log-contract";
import { ClickHouseCanonicalLogRecordRepository } from "../clickhouse.canonical-log-record.repository";
import type { LogClickHouseClient } from "../clickhouse.canonical-log-record-append.repository";

function createRepository(resolveClient: () => Promise<LogClickHouseClient>) {
  return ClickHouseCanonicalLogRecordRepository.create({
    resolveClient,
    defaultRetentionDays: 30,
    defaultReadLimit: 100,
  });
}

function clientWithInsert(insert: LogClickHouseClient["insert"]): LogClickHouseClient {
  return {
    insert,
    query: async () => ({ json: async () => [] }),
  };
}

function clientWithQuery(query: LogClickHouseClient["query"]): LogClickHouseClient {
  return {
    query,
    insert: async () => undefined,
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

describe("ClickHouseCanonicalLogRecordRepository", () => {
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

  it("bounds a trace's log read by time and limit", async () => {
    const query = vi.fn<
      (args: {
        query: string;
        query_params: Record<string, unknown>;
      }) => Promise<{ json: () => Promise<unknown[]> }>
    >(async () => ({ json: async () => [] }));
    const repository = createRepository(async () => clientWithQuery(query));

    await repository.getLogsByTraceId({
      tenantId: "project_test",
      traceId: "b".repeat(32),
      occurredAtMs: 1_700_000_000_000,
      limit: 101,
    });

    const request = query.mock.calls[0]![0];
    expect(request.query).toContain("FROM log_records FINAL");
    expect(request.query).toContain("TimeUnixMs >=");
    expect(request.query).toContain("TimeUnixMs <=");
    expect(request.query).toContain("LIMIT {limit:UInt64}");
    expect(request.query_params).toMatchObject({ limit: 101 });
  });

  describe("when a stored row carries its event name on the EventName column", () => {
    function readOneRow(row: Record<string, unknown>) {
      const query = vi.fn(async () => ({ json: async () => [row] }));
      const repository = createRepository(async () => clientWithQuery(query));
      return repository.getLogsByTraceId({
        tenantId: "project_test",
        traceId: "b".repeat(32),
        occurredAtMs: 1_700_000_000_000,
        limit: 10,
      });
    }

    const storedRow = (over: Record<string, unknown>) => ({
      TraceId: "b".repeat(32),
      SpanId: "c".repeat(16),
      TimeUnixMs: 1_700_000_000_000,
      BodyText: null,
      AttributesFlatJson: "{}",
      ResourceAttributesFlatJson: "{}",
      ScopeName: "codex_exec",
      ScopeVersion: "0.146.0",
      EventName: "",
      ...over,
    });

    /** @scenario "Codex events are rendered whichever way the agent named them" */
    it("backfills event.name so attribute-keyed readers can recognise the record", async () => {
      const [log] = await readOneRow(storedRow({ EventName: "codex.tool_result" }));

      expect(log?.attributes["event.name"]).toBe("codex.tool_result");
    });

    it("leaves an event.name already in the attributes alone", async () => {
      const [log] = await readOneRow(
        storedRow({
          EventName: "codex.tool_result",
          AttributesFlatJson: '{"event.name":"api_request"}',
        }),
      );

      expect(log?.attributes["event.name"]).toBe("api_request");
    });

    it("adds no event.name when the column is empty, so a nameless record stays nameless", async () => {
      const [log] = await readOneRow(storedRow({}));

      expect(log?.attributes["event.name"]).toBeUndefined();
    });
  });
});
