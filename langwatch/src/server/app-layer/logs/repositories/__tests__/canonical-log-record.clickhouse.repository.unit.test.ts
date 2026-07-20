import { describe, expect, it, vi } from "vitest";
import {
  CLAUDE_CODE_KIND_ATTR,
  CLAUDE_CODE_LOG_RETENTION_DAYS,
} from "~/server/app-layer/traces/claude-code-log-to-span";
import type { CanonicalLogRecord } from "~/server/event-sourcing/pipelines/log-processing/schemas/logRecord";
import { CanonicalLogRecordClickHouseRepository } from "../canonical-log-record.clickhouse.repository";

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

describe("CanonicalLogRecordClickHouseRepository", () => {
  it("writes the authoritative row before the payload-free usage estimate", async () => {
    const insert = vi.fn<
      (args: { table: string; values: unknown[] }) => Promise<void>
    >(async () => undefined);
    const repository = new CanonicalLogRecordClickHouseRepository(
      async () => ({ insert }) as never,
    );

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

  describe("given a log record the Claude Code span fold consumes", () => {
    function insertSpy() {
      return vi.fn<(args: { table: string; values: unknown[] }) => Promise<void>>(
        async () => undefined,
      );
    }

    function retentionStampedFor(
      insert: ReturnType<typeof insertSpy>,
    ): unknown {
      const raw = insert.mock.calls[0]![0].values[0] as Record<string, unknown>;
      return raw._retention_days;
    }

    it("caps its retention to the claude-fold floor, not the caller's value", async () => {
      const insert = insertSpy();
      const repository = new CanonicalLogRecordClickHouseRepository(
        async () => ({ insert }) as never,
      );
      const folded = record();
      folded.attributeKeys = [...folded.attributeKeys, CLAUDE_CODE_KIND_ATTR];

      await repository.ensureLogRecord(folded, 49);

      // Folded logs are duplicated by the spans they become, so they must not
      // inherit trace retention. Regression guard for the canonical cutover:
      // the legacy repository capped these and the canonical one initially
      // did not, which would have retained every folded log for the full term.
      expect(retentionStampedFor(insert)).toBe(CLAUDE_CODE_LOG_RETENTION_DAYS);
    });

    it("stamps the floor rather than taking the lower of the two", async () => {
      const insert = insertSpy();
      const repository = new CanonicalLogRecordClickHouseRepository(
        async () => ({ insert }) as never,
      );
      const folded = record();
      folded.attributeKeys = [...folded.attributeKeys, CLAUDE_CODE_KIND_ATTR];

      // 0 is "retain indefinitely". Min-ing against it would keep a
      // fold-intermediate log forever, so the floor is stamped unconditionally.
      await repository.ensureLogRecord(folded, 0);

      expect(retentionStampedFor(insert)).toBe(CLAUDE_CODE_LOG_RETENTION_DAYS);
    });

    it("leaves a record outside the fold on the caller's retention", async () => {
      const insert = insertSpy();
      const repository = new CanonicalLogRecordClickHouseRepository(
        async () => ({ insert }) as never,
      );

      await repository.ensureLogRecord(record(), 49);

      expect(retentionStampedFor(insert)).toBe(49);
    });
  });

  it("writes a same-tenant batch with two ClickHouse inserts total", async () => {
    const insert = vi.fn<
      (args: { table: string; values: unknown[] }) => Promise<void>
    >(async () => undefined);
    const repository = new CanonicalLogRecordClickHouseRepository(
      async () => ({ insert }) as never,
    );
    const second = {
      ...record(),
      recordId: "d".repeat(64),
    };

    await repository.ensureLogRecords([record(), second], 49);

    expect(insert).toHaveBeenCalledTimes(2);
    expect(insert.mock.calls[0]![0].values).toHaveLength(2);
    expect(insert.mock.calls[1]![0].values).toHaveLength(2);
  });

  it("bounds Claude reconstruction reads by time and limit", async () => {
    const query = vi.fn<
      (args: {
        query: string;
        query_params: Record<string, unknown>;
      }) => Promise<{ json: () => Promise<unknown[]> }>
    >(async () => ({ json: async () => [] }));
    const repository = new CanonicalLogRecordClickHouseRepository(
      async () => ({ query }) as never,
    );

    await repository.getMarkedClaudeCodeLogsByTrace(
      "project_test",
      "b".repeat(32),
      1_700_000_000_000,
      101,
    );

    const request = query.mock.calls[0]![0];
    expect(request.query).toContain("FROM log_records FINAL");
    expect(request.query).toContain("TimeUnixMs >=");
    expect(request.query).toContain("TimeUnixMs <=");
    expect(request.query).toContain("LIMIT {limit:UInt64}");
    expect(request.query_params).toMatchObject({ limit: 101 });
  });
});
