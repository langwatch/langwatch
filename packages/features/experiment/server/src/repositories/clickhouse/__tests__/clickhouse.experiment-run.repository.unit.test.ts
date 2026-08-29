import { describe, expect, it, vi } from "vitest";
import { ClickHouseExperimentRunRepository } from "../clickhouse.experiment-run.repository";

describe("ClickHouseExperimentRunRepository", () => {
  const options = {
    database: { workflowVersion: { findMany: async () => [] } } as never,
    resolveClient: async () => null,
    tupleParam: (values: string[]) => values,
    telemetry: {
      trace: async <T>(_input: unknown, operation: () => Promise<T>) => operation(),
      warnOldRuns: () => {},
      error: () => {},
      warn: () => {},
    },
  };

  it("returns null for a polling read when ClickHouse is unavailable", async () => {
    const repository = ClickHouseExperimentRunRepository.create(options);

    await expect(
      repository.tryGet({
        projectId: "project_1",
        experimentId: "experiment_1",
        runId: "run_1",
      }),
    ).resolves.toBeNull();
  });

  it("returns null when a newly started run has not reached ClickHouse yet", async () => {
    const repository = ClickHouseExperimentRunRepository.create({
      ...options,
      resolveClient: async () => ({
        query: async () => ({ json: async () => [] }),
      }),
    });

    await expect(
      repository.tryGet({
        projectId: "project_1",
        experimentId: "experiment_1",
        runId: "run_1",
      }),
    ).resolves.toBeNull();
  });

  it("fails a list read when ClickHouse is unavailable", async () => {
    const repository = ClickHouseExperimentRunRepository.create(options);

    await expect(
      repository.list({
        projectId: "project_1",
        experimentIds: ["experiment_1"],
      }),
    ).rejects.toThrow("Failed to list experiment runs from ClickHouse");
  });

  it("keeps the aggregate query's scope inside its deduplicating subquery", async () => {
    const queries: string[] = [];
    const repository = ClickHouseExperimentRunRepository.create({
      ...options,
      resolveClient: async () => ({
        query: async ({ query }) => {
          queries.push(query);
          return { json: async () => [] };
        },
      }),
    });

    await repository.getAggregates({
      projectId: "project_1",
      experimentIds: ["experiment_1"],
    });

    expect(queries[0]).toMatch(/FROM \(\s*SELECT/s);
    expect(queries[0].match(/WHERE TenantId/g)).toHaveLength(1);
    expect(queries[0]).toMatch(
      /GROUP BY ExperimentId, RunId\s*\)\s*GROUP BY ExperimentId/s,
    );
  });

  it("uses the injected tuple wrapper for exact experiment/run pairs", async () => {
    const tupleParam = vi.fn((values: string[]) => ({ tuple: values }));
    const queries: string[] = [];
    const queryParams: Array<Record<string, unknown>> = [];
    const results = [
      [
        {
          TenantId: "project_1",
          ExperimentId: "experiment_1",
          RunId: "run_1",
          WorkflowVersionId: null,
          Total: 1,
          Progress: 1,
          Targets: "[]",
          CreatedAt: "2026-01-01 00:00:00.000",
          UpdatedAt: "2026-01-01 00:00:00.000",
          FinishedAt: null,
          StoppedAt: null,
        },
      ],
      [],
      [],
    ];
    const repository = ClickHouseExperimentRunRepository.create({
      ...options,
      tupleParam,
      resolveClient: async () => ({
        query: async ({ query, query_params }) => {
          queries.push(query);
          queryParams.push(query_params);
          return { json: async <T>() => (results.shift() ?? []) as T[] };
        },
      }),
    });

    await repository.list({ projectId: "project_1", experimentIds: ["experiment_1"] });

    expect(tupleParam).toHaveBeenCalledWith(["experiment_1", "run_1"]);
    expect(queryParams[1]?.runPairs).toEqual([{ tuple: ["experiment_1", "run_1"] }]);
    expect(queryParams[2]?.runPairs).toEqual([{ tuple: ["experiment_1", "run_1"] }]);
    expect(queries.join("\n")).not.toContain("LIMIT 1 BY");
    expect(queries[0]).toMatch(/max\(UpdatedAt\)/);
    expect(queries[1]).toMatch(/max\(OccurredAt\)/);
    expect(queries[1]).toContain("(ExperimentId, RunId) IN {runPairs");
    expect(queries[1]).toContain("OccurredAt >= {minOccurredAt:DateTime64(3)}");
  });
});
