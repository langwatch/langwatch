import { describe, expect, it, vi } from "vitest";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import type { NormalizedLogRecord } from "~/server/event-sourcing/pipelines/trace-processing/schemas/logRecords";
import {
  CLAUDE_CODE_KIND_ATTR,
  CLAUDE_CODE_LOG_RETENTION_DAYS,
} from "../../claude-code-log-to-span";
import { LogRecordStorageClickHouseRepository } from "../log-record-storage.clickhouse.repository";

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
  const resolveClient = (async () => ({ insert })) as unknown as ConstructorParameters<
    typeof LogRecordStorageClickHouseRepository
  >[0];
  const repo = new LogRecordStorageClickHouseRepository(resolveClient);
  return { repo, insert };
};

const insertedRow = (insert: ReturnType<typeof vi.fn>) =>
  insert.mock.calls[0]![0].values[0] as { _retention_days: number };

const repoCapturingQuery = () => {
  const query = vi
    .fn()
    .mockResolvedValue({ json: async () => [] as unknown[] });
  const resolveClient = (async () => ({ query })) as unknown as ConstructorParameters<
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
  describe("when the log record is part of a Claude Code fold", () => {
    /** @scenario "A folded Claude Code log is retained only briefly" */
    it("caps its retention to the short claude-fold floor instead of the platform default", async () => {
      const { repo, insert } = repoCapturingInsert();

      await repo.insertLogRecord(
        makeRecord({ attributes: { [CLAUDE_CODE_KIND_ATTR]: "model" } }),
      );

      const row = insertedRow(insert);
      expect(row._retention_days).toBe(CLAUDE_CODE_LOG_RETENTION_DAYS);
      expect(row._retention_days).toBeLessThan(PLATFORM_DEFAULT_RETENTION_DAYS);
    });

    it("stamps the floor even when the caller asks for an indefinite (0) retention", async () => {
      const { repo, insert } = repoCapturingInsert();

      await repo.insertLogRecord(
        makeRecord({ attributes: { [CLAUDE_CODE_KIND_ATTR]: "tool" } }),
        0,
      );

      expect(insertedRow(insert)._retention_days).toBe(
        CLAUDE_CODE_LOG_RETENTION_DAYS,
      );
    });
  });

  describe("when the log record is not part of a Claude Code fold", () => {
    /** @scenario "A log record outside the Claude Code fold keeps the platform default retention" */
    it("keeps the platform default retention", async () => {
      const { repo, insert } = repoCapturingInsert();

      await repo.insertLogRecord(makeRecord({ attributes: {} }));

      expect(insertedRow(insert)._retention_days).toBe(
        PLATFORM_DEFAULT_RETENTION_DAYS,
      );
    });

    it("honours an explicit retention override for non-fold logs", async () => {
      const { repo, insert } = repoCapturingInsert();

      await repo.insertLogRecord(makeRecord({ attributes: {} }), 308);

      expect(insertedRow(insert)._retention_days).toBe(308);
    });
  });
});

describe("LogRecordStorageClickHouseRepository.getMarkedClaudeCodeLogsByTrace", () => {
  // stored_log_records is PARTITION BY toYearWeek(TimeUnixMs); the read must
  // carry a TimeUnixMs predicate to prune partitions instead of cold-scanning
  // every weekly partition (incl. cold S3).
  describe("when the caller provides the turn's approximate time", () => {
    it("bounds the scan to a TimeUnixMs window in both the outer and dedup scopes", async () => {
      const { repo, query } = repoCapturingQuery();
      const occurredAtMs = 1_700_000_000_000;

      await repo.getMarkedClaudeCodeLogsByTrace(
        "project_test",
        "trace-1",
        occurredAtMs,
      );

      const { query: sql, query_params } = capturedQuery(query);
      // Predicate present in both the outer SELECT and the dedup subquery.
      expect(sql.match(/TimeUnixMs >= fromUnixTimestamp64Milli/g)).toHaveLength(
        2,
      );
      const windowMs = 2 * 24 * 60 * 60 * 1000;
      expect(query_params.fromMs).toBe(occurredAtMs - windowMs);
      expect(query_params.toMs).toBe(occurredAtMs + windowMs);
    });
  });

  describe("when the caller does not provide a time", () => {
    it("falls back to a CC-retention-bounded window so the scan can't walk every partition", async () => {
      // Replaces a previous "unbounded fallback" behaviour. CC logs older than
      // CLAUDE_CODE_LOG_RETENTION_DAYS have already been TTL'd away anyway, so
      // a 7×retention lookback is safe and bounds the partition scan.
      const { repo, query } = repoCapturingQuery();

      await repo.getMarkedClaudeCodeLogsByTrace("project_test", "trace-1");

      const { query: sql, query_params } = capturedQuery(query);
      expect(sql.match(/TimeUnixMs >= fromUnixTimestamp64Milli/g)).toHaveLength(
        2,
      );
      expect(typeof query_params.fromMs).toBe("number");
      expect(typeof query_params.toMs).toBe("number");
      expect(query_params.toMs).toBeGreaterThan(query_params.fromMs);
    });
  });
});
