import { describe, expect, it, vi } from "vitest";

import {
  ClickHouseExperimentRunRepository,
  RUN_PAIRS_PER_ENRICHMENT_QUERY,
} from "../clickhouse.experiment-run.repository.ts";

describe("ClickHouseExperimentRunRepository", () => {
  const options = {
    workflowVersions: { findByIds: async () => ({}) } as never,
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
      repository.findRun({
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
      repository.findRun({
        projectId: "project_1",
        experimentId: "experiment_1",
        runId: "run_1",
      }),
    ).resolves.toBeNull();
  });

  it("fails a list read when ClickHouse is unavailable", async () => {
    const repository = ClickHouseExperimentRunRepository.create(options);

    await expect(
      repository.findAll({
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

    await repository.findAggregates({
      projectId: "project_1",
      experimentIds: ["experiment_1"],
    });

    const [query] = queries;
    expect(query).toBeDefined();
    expect(query).toMatch(/FROM \(\s*SELECT/s);
    expect(query?.match(/WHERE TenantId/g)).toHaveLength(1);
    expect(query).toMatch(/GROUP BY ExperimentId, RunId\s*\)\s*GROUP BY ExperimentId/s);
  });

  it("uses the injected tuple wrapper for exact experiment/run pairs", async () => {
    const tupleParam = vi.fn((values: string[]) => ({ tuple: values }));
    const queries: string[] = [];
    const queryParams: Record<string, unknown>[] = [];
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

    await repository.findAll({ projectId: "project_1", experimentIds: ["experiment_1"] });

    expect(tupleParam).toHaveBeenCalledWith(["experiment_1", "run_1"]);
    expect(queryParams[1]?.runPairs).toEqual([{ tuple: ["experiment_1", "run_1"] }]);
    expect(queryParams[2]?.runPairs).toEqual([{ tuple: ["experiment_1", "run_1"] }]);
    expect(queries.join("\n")).not.toContain("LIMIT 1 BY");
    expect(queries[0]).toMatch(/max\(UpdatedAt\)/);
    expect(queries[1]).toMatch(/max\(OccurredAt\)/);
    expect(queries[1]).toContain("(ExperimentId, RunId) IN {runPairs");
    expect(queries[1]).toContain("OccurredAt >= {minOccurredAt:DateTime64(3)}");
  });

  describe("when the listed runs outnumber one enrichment lookup", () => {
    /** @scenario "Listing a project with many runs reads their costs and scores in bounded batches" */
    it("reads costs and scores in bounded batches and joins each run to its own", async () => {
      const runCount = RUN_PAIRS_PER_ENRICHMENT_QUERY * 2 + 1;
      const runRows = Array.from({ length: runCount }, (_, index) => ({
        TenantId: "project_1",
        ExperimentId: "experiment_1",
        RunId: `run_${index}`,
        WorkflowVersionId: null,
        Total: 1,
        Progress: 1,
        Targets: "[]",
        CreatedAt: "2026-01-01 00:00:00.000",
        UpdatedAt: "2026-01-01 00:00:00.000",
        FinishedAt: null,
        StoppedAt: null,
      }));
      const pairCounts: number[] = [];
      const repository = ClickHouseExperimentRunRepository.create({
        ...options,
        resolveClient: async () => ({
          query: async ({ query, query_params }) => {
            if (query.includes("FROM experiment_runs")) {
              return { json: async <T>() => runRows as T[] };
            }
            const pairs = query_params.runPairs as string[][];
            pairCounts.push(pairs.length);
            const isCostQuery = query.includes("datasetCost");
            return {
              json: async <T>() =>
                (isCostQuery
                  ? pairs.map(([experimentId, runId]) => ({
                      ExperimentId: experimentId,
                      RunId: runId,
                      datasetCost: Number(runId!.slice("run_".length)),
                      evaluationsCost: null,
                      datasetAverageCost: null,
                      datasetAverageDuration: null,
                      evaluationsAverageCost: null,
                      evaluationsAverageDuration: null,
                    }))
                  : pairs.map(([experimentId, runId]) => ({
                      ExperimentId: experimentId,
                      RunId: runId,
                      EvaluatorId: "evaluator_1",
                      EvaluatorName: "Faithfulness",
                      avgScore: Number(runId!.slice("run_".length)) / runCount,
                      passRate: null,
                      hasPassedCount: 0,
                    }))) as T[],
            };
          },
        }),
      });

      const grouped = await repository.findAll({
        projectId: "project_1",
        experimentIds: ["experiment_1"],
      });

      expect(Math.max(...pairCounts)).toBeLessThanOrEqual(RUN_PAIRS_PER_ENRICHMENT_QUERY);
      expect(pairCounts.reduce((sum, count) => sum + count, 0)).toBe(runCount * 2);
      const runs = grouped.experiment_1 ?? [];
      expect(runs).toHaveLength(runCount);
      // One run from each batch, each joined to its own cost and score.
      for (const index of [0, RUN_PAIRS_PER_ENRICHMENT_QUERY, runCount - 1]) {
        const run = runs.find((candidate) => candidate.runId === `run_${index}`);
        expect(run?.summary.datasetCost).toBe(index);
        expect(run?.summary.evaluations.evaluator_1?.averageScore).toBe(index / runCount);
      }
    });
  });
});
