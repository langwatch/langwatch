import type { ReaderReadStatement } from "@langwatch/clickhouse-client/builder";
import { describe, expect, it } from "vitest";

import {
  ClickHouseExperimentRunRepository,
  RUN_PAIRS_PER_ENRICHMENT_QUERY,
} from "../clickhouse.experiment-run.repository.ts";

/** A run row as the built read answers it: times as text under `…Text`, NO-HOLDS as `Recorded…`. */
const readRowOf = (row: {
  CreatedAt: string;
  UpdatedAt: string;
  FinishedAt: string | null;
  StoppedAt: string | null;
  [key: string]: unknown;
}) => {
  const { CreatedAt, UpdatedAt, FinishedAt, StoppedAt, ...rest } = row;
  return {
    ...rest,
    CreatedAtText: CreatedAt,
    UpdatedAtText: UpdatedAt,
    FinishedAtText: FinishedAt,
    StoppedAtText: StoppedAt,
    RecordedTargetResults: null,
    RecordedEvaluatorResults: null,
    RecordedConcurrency: null,
  };
};

/** The `(experiment, run)` pairs an enrichment read binds as its two zipped string arrays. */
const pairsOf = (statement: ReaderReadStatement): [string, string][] => {
  const [experimentIds = [], runIds = []] = Object.values(statement.params).filter(
    (value): value is string[] => Array.isArray(value),
  );
  return experimentIds.map((experimentId, index) => [experimentId, runIds[index] ?? ""]);
};
const isItemsRead = (statement: ReaderReadStatement) =>
  statement.sql.includes("FROM experiment_run_items");

const expectSingleTenantRead = (statement: ReaderReadStatement | undefined) => {
  expect(statement).toMatchObject({ identity: "reader", kind: "tenant", tenantId: "project_1" });
  expect(statement?.settings).toMatchObject({ SQL_langwatch_tenant_ids: "project_1" });
};

describe("ClickHouseExperimentRunRepository", () => {
  const options = {
    workflowVersions: { findByIds: async () => ({}) } as never,
    resolveClient: async () => null,
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
      resolveClient: async () =>
        ({
          read: async () => ({ rows: [] }),
        }) as never,
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
    const statements: ReaderReadStatement[] = [];
    const repository = ClickHouseExperimentRunRepository.create({
      ...options,
      resolveClient: async () =>
        ({
          read: async ({ statement }: { statement: ReaderReadStatement }) => {
            statements.push(statement);
            return { rows: [] };
          },
        }) as never,
    });

    await repository.findAggregates({
      projectId: "project_1",
      experimentIds: ["experiment_1"],
    });

    const [statement] = statements;
    expectSingleTenantRead(statement);
    const query = statement?.sql ?? "";
    expect(query).toMatch(/FROM \(\s*SELECT/s);
    expect(query.match(/TenantId = \{tenantId:String\}/g)).toHaveLength(1);
    expect(query).toMatch(/GROUP BY [^)]*RunId\s*\)[^(]*GROUP BY/s);
  });

  it("reads exact experiment/run pairs, latest cell each, in the runs' OccurredAt window", async () => {
    const statements: ReaderReadStatement[] = [];
    const runs = [
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
    ];
    const repository = ClickHouseExperimentRunRepository.create({
      ...options,
      resolveClient: async () =>
        ({
          read: async ({ statement }: { statement: ReaderReadStatement }) => {
            statements.push(statement);
            return { rows: isItemsRead(statement) ? [] : runs.map(readRowOf) };
          },
        }) as never,
    });

    await repository.findAll({ projectId: "project_1", experimentIds: ["experiment_1"] });

    const enrichment = statements.filter(isItemsRead);
    expect(enrichment).toHaveLength(2);
    expectSingleTenantRead(statements[0]);
    expect(statements[0]?.sql).toMatch(/max\(UpdatedAt\)/);
    for (const statement of enrichment) {
      expectSingleTenantRead(statement);
      expect(pairsOf(statement)).toEqual([["experiment_1", "run_1"]]);
      expect(statement.sql).not.toContain("LIMIT 1 BY");
      expect(statement.sql).toMatch(/max\(OccurredAt\)/);
      expect(statement.sql).toContain("tuple(ExperimentId, RunId) IN (arrayZip(");
      expect(statement.sql).toMatch(/OccurredAt >= /);
      expect(statement.sql.match(/arrayZip\(/g)).toHaveLength(2);
    }
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
        resolveClient: async () =>
          ({
            read: async ({ statement }: { statement: ReaderReadStatement }) => {
              if (!isItemsRead(statement)) return { rows: runRows.map(readRowOf) };
              const pairs = pairsOf(statement);
              pairCounts.push(pairs.length);
              const isCostQuery = statement.sql.includes("datasetCost");
              return {
                rows: isCostQuery
                  ? pairs.map(([experimentId, runId]) => ({
                      ExperimentId: experimentId,
                      RunId: runId,
                      datasetCost: Number(runId.slice("run_".length)),
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
                      ShownEvaluatorName: "Faithfulness",
                      avgScore: Number(runId.slice("run_".length)) / runCount,
                      passRate: null,
                      hasPassedCount: "0",
                    })),
              };
            },
          }) as never,
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
