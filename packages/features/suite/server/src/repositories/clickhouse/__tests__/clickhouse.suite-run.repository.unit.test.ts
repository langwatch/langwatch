import { describe, expect, it, vi } from "vitest";
import { createTenantId, SecurityError, StoreError } from "@langwatch/eventing";
import { ClickHouseSuiteRunRepository } from "../clickhouse.suite-run.repository";

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
const projectionRow = {
  ProjectionId: "projection_1",
  TenantId: "project_1",
  Version: "2026-08-25",
  ...stateRow,
};
const { LastEventOccurredAt: _legacyLastEventOccurredAt, ...stateReadRow } = stateRow;

function setup(rows: unknown[] = [stateReadRow]) {
  const query = vi.fn().mockResolvedValue({
    json: async <T>(): Promise<T[]> => rows as T[],
  });
  const insert = vi.fn().mockResolvedValue(undefined);
  const repository = ClickHouseSuiteRunRepository.create({
    resolveClient: async () => ({ query, insert }),
    defaultRetentionDays: 30,
  });
  return { repository, query, insert };
}

describe("ClickHouseSuiteRunRepository", () => {
  it("maps the complete suite run state shape", async () => {
    const { repository } = setup();
    await expect(
      repository.getSuiteRunState({
        projectId: "project_1",
        batchRunId: "batch_1",
      }),
    ).resolves.toEqual({ ...stateRow, LastEventOccurredAt: 0 });
  });

  it("deduplicates latest state by the tenant and batch tuple", async () => {
    const { repository, query } = setup([]);
    await repository.getSuiteRunState({ projectId: "project_1", batchRunId: "batch_1" });
    const sql = query.mock.calls[0]?.[0]?.query as string;
    expect(sql).toContain("(t.TenantId, t.BatchRunId, t.UpdatedAt) IN");
    expect(sql).toContain("GROUP BY TenantId, BatchRunId");
  });

  it("reads and writes the same row shape used by the Eventing fold store", async () => {
    const { repository, insert } = setup([projectionRow]);
    await expect(
      repository.getProjection("batch_1", { tenantId: createTenantId("project_1") }),
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
        clickhouse_settings: { async_insert: 1, wait_for_async_insert: 0 },
      }),
    );
    expect(insert.mock.calls[0]?.[0]?.values[0]).toMatchObject({
      LastEventOccurredAt: new Date(stateRow.LastEventOccurredAt),
      _retention_days: 14,
    });
  });

  it("preserves the default-set compatibility filter and history limits", async () => {
    const { repository, query } = setup([]);
    await repository.getBatchHistory({
      projectId: "project_1",
      scenarioSetId: "default",
    });
    await repository.getBatchHistory({
      projectId: "project_1",
      scenarioSetId: "default",
      limit: 999,
    });
    const defaultInput = query.mock.calls[0]?.[0] as {
      query_params: Record<string, unknown>;
    };
    const cappedInput = query.mock.calls[1]?.[0] as {
      query_params: Record<string, unknown>;
    };
    expect(defaultInput.query_params).toMatchObject({
      scenarioSetIds: ["default", ""],
      limit: 50,
    });
    expect(cappedInput.query_params.limit).toBe(100);
  });

  it("wraps ClickHouse resolution failures instead of silently succeeding", async () => {
    const repository = ClickHouseSuiteRunRepository.create({
      resolveClient: async () => {
        throw new Error("clickhouse unavailable");
      },
      defaultRetentionDays: 30,
    });
    await expect(
      repository.getProjection("b", { tenantId: createTenantId("p") }),
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
        clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
        values: [expect.objectContaining({ _retention_days: 30 })],
      }),
    );
  });
});
