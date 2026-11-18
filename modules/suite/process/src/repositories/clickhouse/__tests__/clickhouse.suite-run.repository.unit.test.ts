import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { createTenantId, SecurityError, StoreError } from "@langwatch/eventing";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { OPEN_SUITE_RUN_STATUSES } from "#rules/suite-run-open.rules";

import { ClickHouseSuiteRunRepository } from "../clickhouse.suite-run.repository.ts";

const stateRow = {
  SuiteRunId: "run_1",
  BatchRunId: "batch_1",
  ScenarioSetId: "suite:set_1",
  SuiteId: "suite_1",
  Status: "SUCCESS",
  Total: 2,
  StartedCount: 2,
  CompletedCount: 2,
  FailedCount: 0,
  Progress: 2,
  PassRateBps: 10000,
  PassedCount: 2,
  GradedCount: 2,
  CreatedAt: 100,
  UpdatedAt: 200,
  LastEventOccurredAt: 190,
  StartedAt: 110,
  FinishedAt: 190,
};
/** The row as the built read selects it: keys apart from the stored names, times in millis. */
const stateReadRow = {
  suiteRunId: stateRow.SuiteRunId,
  batchRunId: stateRow.BatchRunId,
  scenarioSetId: stateRow.ScenarioSetId,
  suiteId: stateRow.SuiteId,
  status: stateRow.Status,
  total: stateRow.Total,
  startedCount: stateRow.StartedCount,
  completedCount: stateRow.CompletedCount,
  failedCount: stateRow.FailedCount,
  progress: stateRow.Progress,
  passRateBps: stateRow.PassRateBps,
  passedCount: stateRow.PassedCount,
  gradedCount: stateRow.GradedCount,
  createdAtMs: String(stateRow.CreatedAt),
  updatedAtMs: String(stateRow.UpdatedAt),
  lastEventOccurredAtMs: String(stateRow.LastEventOccurredAt),
  startedAtMs: String(stateRow.StartedAt),
  finishedAtMs: String(stateRow.FinishedAt),
};
const projectionReadRow = { projectionId: "projection_1", version: "2026-08-25", ...stateReadRow };

/**
 * The process's one ClickHouse client, stood in for. Nothing here resolves an
 * endpoint: the repository names its tenant on every statement and the client
 * routes it, which is what these cases assert.
 */
function setup(rows: unknown[] = [stateReadRow]) {
  const read = vi.fn().mockResolvedValue({ rows });
  const insert = vi.fn().mockResolvedValue(undefined);
  const repository = ClickHouseSuiteRunRepository.create({
    clickhouse: createApiFixture<ClickHouseQueryClient>({ read, insert }),
    defaultRetentionDays: () => 30,
  });
  return { repository, read, insert };
}

describe("ClickHouseSuiteRunRepository", () => {
  /** Every write names the tenant the client routes it by. */
  it("names the tenant on the batch it writes", async () => {
    const { repository, insert } = setup([]);
    await repository.storeProjectionBatch(
      [
        {
          id: "projection_2",
          aggregateId: "batch_1",
          tenantId: createTenantId("project_1"),
          version: "2026-08-25",
          data: stateRow,
        },
      ],
      { tenantId: createTenantId("project_1") },
    );
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "project_1", table: "suite_runs" }),
    );
  });

  it("reads and writes the same row shape used by the Eventing fold store", async () => {
    const { repository, insert } = setup([projectionReadRow]);
    await expect(
      repository.findProjection("batch_1", { tenantId: createTenantId("project_1") }),
    ).resolves.toMatchObject({
      id: "projection_1",
      aggregateId: "batch_1",
      tenantId: "project_1",
      version: "2026-08-25",
      data: stateRow,
    });

    await repository.storeProjection(
      {
        id: "projection_2",
        aggregateId: "batch_1",
        tenantId: createTenantId("project_1"),
        version: "2026-08-25",
        data: stateRow,
      },
      {
        tenantId: createTenantId("project_1"),
        metadata: { retentionPolicy: { scenarios: 14 } },
      },
    );
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        table: "suite_runs",
        settings: { async_insert: 1, wait_for_async_insert: 0 },
      }),
    );
    expect(insert.mock.calls[0]?.[0]?.rows[0]).toMatchObject({
      LastEventOccurredAt: new Date(stateRow.LastEventOccurredAt),
      _retention_days: 14,
    });
  });

  it("wraps ClickHouse failures instead of silently succeeding", async () => {
    const repository = ClickHouseSuiteRunRepository.create({
      clickhouse: createApiFixture<ClickHouseQueryClient>({
        read: async () => {
          throw new Error("clickhouse unavailable");
        },
        insert: async () => {},
      }),
      defaultRetentionDays: () => 30,
    });
    await expect(
      repository.findProjection("b", { tenantId: createTenantId("p") }),
    ).rejects.toBeInstanceOf(StoreError);
  });

  it("rejects a projection written for another tenant", async () => {
    const { repository } = setup([]);
    await expect(
      repository.storeProjection(
        {
          id: "projection_2",
          aggregateId: "batch_1",
          tenantId: createTenantId("other"),
          version: "2026-08-25",
          data: stateRow,
        },
        { tenantId: createTenantId("project_1") },
      ),
    ).rejects.toBeInstanceOf(SecurityError);
  });

  it("uses the blocking async-insert mode for projection batches", async () => {
    const { repository, insert } = setup([]);
    await repository.storeProjectionBatch([], {
      tenantId: createTenantId("project_1"),
      metadata: { retentionPolicy: { scenarios: 14 } },
    });
    expect(insert).not.toHaveBeenCalled();

    await repository.storeProjectionBatch(
      [
        {
          id: "projection_2",
          aggregateId: "batch_1",
          tenantId: createTenantId("project_1"),
          version: "2026-08-25",
          data: stateRow,
        },
      ],
      { tenantId: createTenantId("project_1") },
    );
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: { async_insert: 1, wait_for_async_insert: 1 },
        rows: [expect.objectContaining({ _retention_days: 30 })],
      }),
    );
  });

  describe("given the replay sweep for a tenant's open runs", () => {
    /** @scenario "A tenant's open suite-run sweep is a declared full scan" */
    it("declares a full scan, since a run started in any week can still be open", async () => {
      const { repository, read } = setup([stateReadRow]);

      await expect(repository.findOpenRuns({ tenantId: "project_1" })).resolves.toEqual([stateRow]);

      expect(read).toHaveBeenCalledWith(
        expect.objectContaining({ table: "suite_runs", declaresFullScan: true }),
      );
    });
  });

  describe("given the built reads", () => {
    it("scopes the projection read to its one tenant, elected by its batch run id index", () => {
      const statement = ClickHouseSuiteRunRepository.projectionRead({
        tenantId: "project_1",
        batchRunId: "batch_1",
      });

      expect(statement.identity).toBe("reader");
      expect(statement.kind).toBe("tenant");
      expect(statement.tenantId).toBe("project_1");
      expect(statement.settings.SQL_langwatch_tenant_ids).toBe("project_1");
      expect(statement.sql).toContain("{{idBound:suite_runs.BatchRunId:");
      expect(statement.sql).toMatch(
        /IN \(SELECT TenantId, ScenarioSetId, BatchRunId, max\(UpdatedAt\)/,
      );
      expect(statement.sql).toContain("LIMIT 1");
    });

    it("scopes the open-runs sweep to its one tenant and asks status after the election", () => {
      const statement = ClickHouseSuiteRunRepository.openRunsRead({ tenantId: "project_1" });

      expect(statement.identity).toBe("reader");
      expect(statement.kind).toBe("tenant");
      expect(statement.tenantId).toBe("project_1");
      expect(statement.settings.SQL_langwatch_tenant_ids).toBe("project_1");
      expect(statement.sql).toContain("LIMIT 1 BY");
      expect(Object.values(statement.params)).toContainEqual([...OPEN_SUITE_RUN_STATUSES]);
    });

    it("sums its one tenant's stored bytes under the meter's thread and time caps", () => {
      const statement = ClickHouseSuiteRunRepository.storedBytesRead({ tenantId: "project_1" });

      expect(statement.identity).toBe("reader");
      expect(statement.kind).toBe("tenant");
      expect(statement.tenantId).toBe("project_1");
      expect(statement.settings.SQL_langwatch_tenant_ids).toBe("project_1");
      expect(statement.sql).toContain("sum(_size_bytes)");
      expect(statement.sql).toContain("SETTINGS max_threads = 2, max_execution_time = 45");
    });
  });
});

describe("ClickHouseSuiteRunRepository.storedBytesRead before a cutoff", () => {
  const beforeMs = Date.UTC(2026, 7, 1);

  /** @scenario "Suite's stored bytes before a cutoff count only rows whose partition time is earlier" */
  it("keeps only rows whose `StartedAt` is before the cutoff", () => {
    const statement = ClickHouseSuiteRunRepository.storedBytesRead({
      tenantId: "project_1",
      beforeMs: beforeMs,
    });

    expect(statement.sql).toMatch(/StartedAt\)? < /);
    expect(Object.values(statement.params)).toContain(beforeMs);
  });

  it("filters on no time without a cutoff", () => {
    expect(ClickHouseSuiteRunRepository.storedBytesRead({ tenantId: "project_1" }).sql).not.toMatch(
      /StartedAt\)? < /,
    );
  });
});
