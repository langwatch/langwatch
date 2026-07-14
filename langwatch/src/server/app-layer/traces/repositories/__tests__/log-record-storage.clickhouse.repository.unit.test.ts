import { describe, expect, it, vi } from "vitest";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import type { NormalizedLogRecord } from "~/server/event-sourcing/pipelines/trace-processing/schemas/logRecords";
import { LogRecordStorageClickHouseRepository } from "../log-record-storage.clickhouse.repository";

// Legacy attribute key the ingest path used to stamp on claude_code content
// logs. The marking is gone; this key is asserted here only to pin that the
// read path never filters on it.
const LEGACY_CLAUDE_KIND_ATTR = "langwatch.claude_code.kind";

const makeRecord = (
  over: Partial<NormalizedLogRecord> = {},
): NormalizedLogRecord => ({
  id: "proj-1",
  tenantId: "project_test",
  traceId: "a3c6656cf433e97549f654034be02955",
  spanId: "9376fa726d53e62a",
  timeUnixMs: 1_700_000_000_000,
  severityNumber: 9,
  severityText: "INFO",
  body: "{}",
  attributes: {},
  resourceAttributes: {},
  scopeName: "com.anthropic.claude_code.events",
  scopeVersion: null,
  ...over,
});

const repoCapturingInsert = () => {
  const insert = vi.fn().mockResolvedValue(undefined);
  const resolveClient = (async () => ({
    insert,
  })) as unknown as ConstructorParameters<
    typeof LogRecordStorageClickHouseRepository
  >[0];
  const repo = new LogRecordStorageClickHouseRepository(resolveClient);
  return { repo, insert };
};

const insertedRow = (insert: ReturnType<typeof vi.fn>) =>
  insert.mock.calls[0]![0].values[0] as { _retention_days: number };

const repoCapturingQuery = (rows: unknown[] = []) => {
  const query = vi.fn().mockResolvedValue({ json: async () => rows });
  const resolveClient = (async () => ({
    query,
  })) as unknown as ConstructorParameters<
    typeof LogRecordStorageClickHouseRepository
  >[0];
  const repo = new LogRecordStorageClickHouseRepository(resolveClient);
  return { repo, query };
};

const capturedQuery = (query: ReturnType<typeof vi.fn>) =>
  query.mock.calls[0]![0] as {
    query: string;
    query_params: Record<string, unknown>;
  };

describe("LogRecordStorageClickHouseRepository.insertLogRecord", () => {
  describe("when the log record is a Claude Code content log", () => {
    // Claude Code logs are the content-of-record now (no longer duplicated onto
    // synthesized spans), so a claude-kind log gets the caller's normal
    // retention like any other log — no special short floor.
    it("keeps the platform default retention", async () => {
      const { repo, insert } = repoCapturingInsert();

      await repo.insertLogRecord(
        makeRecord({ attributes: { [LEGACY_CLAUDE_KIND_ATTR]: "model" } }),
      );

      expect(insertedRow(insert)._retention_days).toBe(
        PLATFORM_DEFAULT_RETENTION_DAYS,
      );
    });

    it("honours an explicit retention override", async () => {
      const { repo, insert } = repoCapturingInsert();

      await repo.insertLogRecord(
        makeRecord({ attributes: { [LEGACY_CLAUDE_KIND_ATTR]: "tool" } }),
        308,
      );

      expect(insertedRow(insert)._retention_days).toBe(308);
    });
  });

  describe("when the log record is a plain log", () => {
    it("keeps the platform default retention", async () => {
      const { repo, insert } = repoCapturingInsert();

      await repo.insertLogRecord(makeRecord({ attributes: {} }));

      expect(insertedRow(insert)._retention_days).toBe(
        PLATFORM_DEFAULT_RETENTION_DAYS,
      );
    });

    it("honours an explicit retention override", async () => {
      const { repo, insert } = repoCapturingInsert();

      await repo.insertLogRecord(makeRecord({ attributes: {} }), 308);

      expect(insertedRow(insert)._retention_days).toBe(308);
    });
  });
});

describe("LogRecordStorageClickHouseRepository.getLogsByTraceId", () => {
  // stored_log_records is PARTITION BY toYearWeek(TimeUnixMs); the read must
  // carry a TimeUnixMs predicate to prune partitions instead of cold-scanning
  // every weekly partition (incl. cold S3).
  describe("when the caller provides the trace's approximate time", () => {
    it("bounds the scan to a ±2d TimeUnixMs window in both the outer and dedup scopes", async () => {
      const { repo, query } = repoCapturingQuery();
      const occurredAtMs = 1_700_000_000_000;

      await repo.getLogsByTraceId("project_test", "trace-1", occurredAtMs);

      const { query: sql, query_params } = capturedQuery(query);
      expect(sql.match(/TimeUnixMs >= fromUnixTimestamp64Milli/g)).toHaveLength(
        2,
      );
      const windowMs = 2 * 24 * 60 * 60 * 1000;
      expect(query_params.fromMs).toBe(occurredAtMs - windowMs);
      expect(query_params.toMs).toBe(occurredAtMs + windowMs);
    });
  });

  describe("when the caller does not provide a time", () => {
    it("falls back to a 90d-lookback window with clock-skew headroom on the upper bound", async () => {
      const { repo, query } = repoCapturingQuery();
      const before = Date.now();

      await repo.getLogsByTraceId("project_test", "trace-1");

      const after = Date.now();
      const { query: sql, query_params } = capturedQuery(query);
      expect(sql.match(/TimeUnixMs >= fromUnixTimestamp64Milli/g)).toHaveLength(
        2,
      );
      const partitionWindowMs = 2 * 24 * 60 * 60 * 1000;
      const lookbackMs = 90 * 24 * 60 * 60 * 1000;
      const toMs = query_params.toMs as number;
      const fromMs = query_params.fromMs as number;
      // Upper bound is now() + 2d (clock-skew headroom).
      expect(toMs).toBeGreaterThanOrEqual(before + partitionWindowMs);
      expect(toMs).toBeLessThanOrEqual(after + partitionWindowMs);
      // The gap between fromMs and toMs is the 90d lookback + the headroom.
      expect(toMs - fromMs).toBe(lookbackMs + partitionWindowMs);
    });
  });

  describe("when reading the trace's logs (generic — no claude-kind filter)", () => {
    it("selects the Body + Attributes and does not filter on the claude kind attr", async () => {
      const { repo, query } = repoCapturingQuery();

      await repo.getLogsByTraceId("project_test", "trace-1", 1_700_000_000_000);

      const { query: sql, query_params } = capturedQuery(query);
      expect(sql).toContain("Body");
      expect(sql).toContain("Attributes");
      // The generic read must NOT re-introduce the retired claude-kind filter.
      expect(sql).not.toContain(LEGACY_CLAUDE_KIND_ATTR);
      expect(sql).not.toMatch(/Attributes\[\{kindKey/);
      expect(query_params.tenantId).toBe("project_test");
      expect(query_params.traceId).toBe("trace-1");
    });

    it("maps stored rows to StoredLogRecordRow with body + attributes + scope", async () => {
      const { repo } = repoCapturingQuery([
        {
          TraceId: "trace-1",
          SpanId: "span-1",
          TimeUnixMs: 1_700_000_000_000,
          Body: "api_request_body",
          Attributes: { "event.name": "api_request_body", body: '{"x":1}' },
          ResourceAttributes: { "langwatch.origin": "coding_agent" },
          ScopeName: "com.anthropic.claude_code.events",
          ScopeVersion: "1.2.3",
        },
      ]);

      const rows = await repo.getLogsByTraceId(
        "project_test",
        "trace-1",
        1_700_000_000_000,
      );

      expect(rows).toEqual([
        {
          traceId: "trace-1",
          spanId: "span-1",
          timeUnixMs: 1_700_000_000_000,
          body: "api_request_body",
          attributes: { "event.name": "api_request_body", body: '{"x":1}' },
          resourceAttributes: { "langwatch.origin": "coding_agent" },
          scopeName: "com.anthropic.claude_code.events",
          scopeVersion: "1.2.3",
        },
      ]);
    });
  });
});
