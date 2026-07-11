import { describe, expect, it, vi } from "vitest";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import type { NormalizedLogRecord } from "~/server/event-sourcing/pipelines/trace-processing/schemas/logRecords";
import { CLAUDE_CODE_KIND_ATTR } from "../../claude-code-log-events";
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

describe("LogRecordStorageClickHouseRepository.insertLogRecord", () => {
  describe("when the log record is a Claude Code content log", () => {
    // Claude Code logs are the content-of-record now (no longer duplicated onto
    // synthesized spans), so a claude-kind log gets the caller's normal
    // retention like any other log — no special short floor.
    it("keeps the platform default retention", async () => {
      const { repo, insert } = repoCapturingInsert();

      await repo.insertLogRecord(
        makeRecord({ attributes: { [CLAUDE_CODE_KIND_ATTR]: "model" } }),
      );

      expect(insertedRow(insert)._retention_days).toBe(
        PLATFORM_DEFAULT_RETENTION_DAYS,
      );
    });

    it("honours an explicit retention override", async () => {
      const { repo, insert } = repoCapturingInsert();

      await repo.insertLogRecord(
        makeRecord({ attributes: { [CLAUDE_CODE_KIND_ATTR]: "tool" } }),
        308,
      );

      expect(insertedRow(insert)._retention_days).toBe(308);
    });
  });

  describe("when the log record is a plain log", () => {
    /** @scenario "A log record keeps the platform default retention" */
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
