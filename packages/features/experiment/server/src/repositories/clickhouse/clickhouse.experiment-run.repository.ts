import type {
  ExperimentRun,
  ExperimentRunAggregate,
  ExperimentRunListInput,
  ExperimentRunLookup,
  ExperimentRunPageInput,
  ExperimentRunWithItems,
  ExperimentRunWorkflowVersion,
} from "@langwatch/experiment-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import {
  experimentRunSchema,
  serializedHandledErrorSchema,
  experimentRunTargetSchema,
  experimentRunWithItemsSchema,
} from "@langwatch/experiment-contract";
import { ExperimentRunRepository } from "../experiment-run.repository";
import {
  buildDedupedRunItemsWhere,
  computeOccurredAtRangeForRuns,
  OCCURRED_AT_BUFFER_MS,
  WARN_OLD_RUN_AGE_MS,
} from "./clickhouse-experiment-run.queries";

type QueryResult = { json<T>(): Promise<T[]> };
type ExperimentClickHouseClient = {
  query(input: {
    query: string;
    query_params: Record<string, unknown>;
    format: "JSONEachRow";
  }): Promise<QueryResult>;
};

type ExperimentRunVersionDatabase = Pick<PrismaClient, "workflowVersion">;

type ClickHouseExperimentRunRepositoryOptions = {
  database: ExperimentRunVersionDatabase;
  resolveClient: (projectId: string) => Promise<ExperimentClickHouseClient | null>;
  tupleParam: (values: string[]) => unknown;
  telemetry: {
    trace<T>(
      input: {
        name: string;
        attributes: Record<string, string | number>;
      },
      operation: () => Promise<T>,
    ): Promise<T>;
    warnOldRuns(input: {
      projectId: string;
      oldestRunAgeDays: number;
      runCount: number;
      occurredAtBufferHours: number;
    }): void;
    error(
      input: {
        projectId: string;
        experimentId?: string;
        runId?: string;
        error: unknown;
      },
      message: string,
    ): void;
    warn(input: { projectId: string; error: unknown }, message: string): void;
  };
};

type RunRow = {
  TenantId: string;
  RunId: string;
  ExperimentId: string;
  WorkflowVersionId: string | null;
  Total: number;
  Progress: number;
  Targets: string;
  CreatedAt: string;
  UpdatedAt: string;
  FinishedAt: string | null;
  StoppedAt: string | null;
};
type ItemRow = {
  TenantId: string;
  RunId: string;
  ExperimentId: string;
  RowIndex: number;
  TargetId: string;
  ResultType: "target" | "evaluator";
  DatasetEntry: string;
  Predicted: string | null;
  TargetCost: number | null;
  TargetDurationMs: number | null;
  TargetError: string | null;
  TargetDomainError: string | null;
  TraceId: string | null;
  EvaluatorId: string | null;
  EvaluatorName: string | null;
  EvaluationStatus: string;
  Score: number | null;
  Label: string | null;
  Passed: number | null;
  EvaluationDetails: string | null;
  EvaluationCost: number | null;
  EvaluationInputs: string | null;
  EvaluationDurationMs: number | null;
};
type BreakdownRow = {
  ExperimentId: string;
  RunId: string;
  EvaluatorId: string;
  EvaluatorName: string | null;
  avgScore: number | null;
  passRate: number | null;
  hasPassedCount: number;
};
type CostRow = {
  ExperimentId: string;
  RunId: string;
  datasetCost: number | null;
  evaluationsCost: number | null;
  datasetAverageCost: number | null;
  datasetAverageDuration: number | null;
  evaluationsAverageCost: number | null;
  evaluationsAverageDuration: number | null;
};

const parseRecord = (value: string | null): Record<string, unknown> | undefined => {
  if (!value) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
};
const runKey = (experimentId: string, runId: string): string => `${experimentId}:${runId}`;

export class ClickHouseExperimentRunRepository extends ExperimentRunRepository {
  static create(options: ClickHouseExperimentRunRepositoryOptions): ClickHouseExperimentRunRepository {
    return new ClickHouseExperimentRunRepository(options);
  }

  private constructor(private readonly options: ClickHouseExperimentRunRepositoryOptions) { super(); }

  async list(input: ExperimentRunListInput): Promise<Record<string, ExperimentRun[]>> {
    return this.options.telemetry.trace({
      name: "ExperimentRunService.listRuns",
      attributes: {
        "tenant.id": input.projectId,
        "experiment.count": input.experimentIds.length,
      },
    }, async () => {
      if (input.experimentIds.length === 0) return {};
      try {
        const client = await this.requireClient(input.projectId);
        const runs = await this.enrichRuns(client, input.projectId, await this.rowsForExperiments(client, input));
        const grouped: Record<string, ExperimentRun[]> = {};
        for (const run of runs) {
          (grouped[run.experimentId] ??= []).push(run);
        }
        return grouped;
      } catch (error) {
        this.options.telemetry.error({ projectId: input.projectId, error }, "Failed to list experiment runs from ClickHouse");
        throw new Error("Failed to list experiment runs from ClickHouse");
      }
    });
  }

  async getAggregates(input: ExperimentRunListInput): Promise<Record<string, ExperimentRunAggregate>> {
    return this.options.telemetry.trace(
      {
        name: "ExperimentRunService.getRunAggregatesForExperimentIds",
        attributes: {
          "tenant.id": input.projectId,
          "experiment.count": input.experimentIds.length,
        },
      },
      async () => {
        if (input.experimentIds.length === 0) return {};

        const client = await this.requireClient(input.projectId);
        const result = await client.query({
          query: `
            SELECT
              ExperimentId,
              count() AS runsCount,
              max(toUnixTimestamp64Milli(CreatedAt)) AS lastRunAt
            FROM (
              SELECT
                ExperimentId,
                RunId,
                argMax(CreatedAt, UpdatedAt) AS CreatedAt
              FROM experiment_runs
              WHERE TenantId = {tenantId:String}
                AND ExperimentId IN ({experimentIds:Array(String)})
              GROUP BY ExperimentId, RunId
            )
            GROUP BY ExperimentId
          `,
          query_params: {
            tenantId: input.projectId,
            experimentIds: input.experimentIds,
          },
          format: "JSONEachRow",
        });
        const rows = await result.json<{
          ExperimentId: string;
          runsCount: number | string;
          lastRunAt: number | string | null;
        }>();

        return Object.fromEntries(
          rows.map((row) => [
            row.ExperimentId,
            {
              runsCount: Number(row.runsCount),
              lastRunAt:
                row.lastRunAt === null ? null : Number(row.lastRunAt),
            },
          ]),
        );
      },
    );
  }

  async getPage(input: ExperimentRunPageInput): Promise<{ runs: ExperimentRun[]; totalHits: number }> {
    return this.options.telemetry.trace({
      name: "ExperimentRunService.listRunsForExperimentPaginated",
      attributes: {
        "tenant.id": input.projectId,
        "experiment.id": input.experimentId,
        page: input.page,
        pageSize: input.pageSize,
      },
    }, async () => {
      const client = await this.requireClient(input.projectId);
      const offset = (input.page - 1) * input.pageSize;
      try {
        const [countResult, runsResult] = await Promise.all([
          client.query({
            query: `
              SELECT uniqExact(RunId) AS totalHits
              FROM experiment_runs
              WHERE TenantId = {tenantId:String}
                AND ExperimentId = {experimentId:String}
            `,
            query_params: {
              tenantId: input.projectId,
              experimentId: input.experimentId,
            },
            format: "JSONEachRow",
          }),
          client.query({
            query: `
              SELECT *
              FROM experiment_runs AS t
              WHERE t.TenantId = {tenantId:String}
                AND t.ExperimentId = {experimentId:String}
                AND (t.TenantId, t.RunId, t.ExperimentId, t.UpdatedAt) IN (
                  SELECT TenantId, RunId, ExperimentId, max(UpdatedAt)
                  FROM experiment_runs
                  WHERE TenantId = {tenantId:String}
                    AND ExperimentId = {experimentId:String}
                  GROUP BY TenantId, RunId, ExperimentId
                )
              ORDER BY t.CreatedAt DESC, t.RunId DESC
              LIMIT {pageSize:UInt32}
              OFFSET {offset:UInt32}
            `,
            query_params: {
              tenantId: input.projectId,
              experimentId: input.experimentId,
              pageSize: input.pageSize,
              offset,
            },
            format: "JSONEachRow",
          }),
        ]);
        const [countRows, runRows] = await Promise.all([
          countResult.json<{ totalHits: number | string }>(),
          runsResult.json<RunRow>(),
        ]);
        if (runRows.length === 0) {
          return { runs: [], totalHits: Number(countRows[0]?.totalHits ?? 0) };
        }
        return {
          totalHits: Number(countRows[0]?.totalHits ?? 0),
          runs: await this.enrichRuns(client, input.projectId, runRows),
        };
      } catch (error) {
        this.options.telemetry.error({ projectId: input.projectId, experimentId: input.experimentId, error }, "Failed to list paginated experiment runs from ClickHouse");
        throw new Error("Failed to list paginated experiment runs from ClickHouse");
      }
    });
  }

  async tryGet(input: ExperimentRunLookup): Promise<ExperimentRunWithItems | null> {
    return this.options.telemetry.trace({
      name: "ExperimentRunService.getRun",
      attributes: { "tenant.id": input.projectId, "run.id": input.runId },
    }, async () => {
      const client = await this.options.resolveClient(input.projectId);
      if (!client) return null;

      try {
        const result = await client.query({
          query: `
            SELECT *
            FROM experiment_runs
            WHERE TenantId = {tenantId:String}
              AND ExperimentId = {experimentId:String}
              AND RunId = {runId:String}
              AND UpdatedAt = (
                SELECT max(UpdatedAt)
                FROM experiment_runs
                WHERE TenantId = {tenantId:String}
                  AND ExperimentId = {experimentId:String}
                  AND RunId = {runId:String}
              )
            LIMIT 1
          `,
          query_params: {
            tenantId: input.projectId,
            experimentId: input.experimentId,
            runId: input.runId,
          },
          format: "JSONEachRow",
        });
        const run = (await result.json<RunRow>())[0];
        if (!run) return null;

        const range = computeOccurredAtRangeForRuns([run]);
        this.warnIfRunsAreOld(input.projectId, range.minMs, 1);
        const itemsResult = await client.query({
          query: `
            SELECT *
            FROM experiment_run_items
            WHERE TenantId = {tenantId:String}
              AND ExperimentId = {experimentId:String}
              AND RunId = {runId:String}
              AND OccurredAt >= {minOccurredAt:DateTime64(3)}
              AND OccurredAt <= {maxOccurredAt:DateTime64(3)}
              AND (TenantId, ExperimentId, RunId, RowIndex, TargetId, ResultType, coalesce(EvaluatorId, ''), OccurredAt) IN (
                SELECT
                  TenantId,
                  ExperimentId,
                  RunId,
                  RowIndex,
                  TargetId,
                  ResultType,
                  coalesce(EvaluatorId, ''),
                  max(OccurredAt)
                FROM experiment_run_items
                WHERE TenantId = {tenantId:String}
                  AND ExperimentId = {experimentId:String}
                  AND RunId = {runId:String}
                  AND OccurredAt >= {minOccurredAt:DateTime64(3)}
                  AND OccurredAt <= {maxOccurredAt:DateTime64(3)}
                GROUP BY TenantId, ExperimentId, RunId, RowIndex, TargetId, ResultType, coalesce(EvaluatorId, '')
              )
            ORDER BY RowIndex ASC, ResultType ASC
          `,
          query_params: {
            tenantId: input.projectId,
            experimentId: input.experimentId,
            runId: input.runId,
            minOccurredAt: range.minOccurredAt,
            maxOccurredAt: range.maxOccurredAt,
          },
          format: "JSONEachRow",
        });
        const items = await this.enrichItemCosts(
          client,
          input.projectId,
          await itemsResult.json<ItemRow>(),
          range,
        );
        return mapRunWithItems(run, items, input.projectId);
      } catch (error) {
        this.options.telemetry.error(
          { projectId: input.projectId, runId: input.runId, error },
          "Failed to fetch experiment run from ClickHouse",
        );
        throw new Error("Failed to fetch experiment run from ClickHouse");
      }
    });
  }

  private async requireClient(projectId: string): Promise<ExperimentClickHouseClient> {
    const client = await this.options.resolveClient(projectId);
    if (!client) throw new Error(`ClickHouse client unavailable for project ${projectId}`);
    return client;
  }

  private async rowsForExperiments(client: ExperimentClickHouseClient, input: ExperimentRunListInput): Promise<RunRow[]> {
    const result = await client.query({
      query: `
        SELECT *
        FROM experiment_runs AS t
        WHERE t.TenantId = {tenantId:String}
          AND t.ExperimentId IN ({experimentIds:Array(String)})
          AND (t.TenantId, t.RunId, t.ExperimentId, t.UpdatedAt) IN (
            SELECT TenantId, RunId, ExperimentId, max(UpdatedAt)
            FROM experiment_runs
            WHERE TenantId = {tenantId:String}
              AND ExperimentId IN ({experimentIds:Array(String)})
            GROUP BY TenantId, RunId, ExperimentId
          )
        ORDER BY t.CreatedAt DESC
        LIMIT 10000
      `,
      query_params: {
        tenantId: input.projectId,
        experimentIds: input.experimentIds,
      },
      format: "JSONEachRow",
    });
    return result.json<RunRow>();
  }

  private async enrichRuns(client: ExperimentClickHouseClient, projectId: string, rows: RunRow[]): Promise<ExperimentRun[]> {
    if (rows.length === 0) return [];
    const range = computeOccurredAtRangeForRuns(rows);
    this.warnIfRunsAreOld(projectId, range.minMs, rows.length);
    const runPairs = rows.map((row) => this.options.tupleParam([row.ExperimentId, row.RunId]));
    const [breakdownResult, costResult, versions] = await Promise.all([
      client.query({
        query: `
          SELECT
            ExperimentId,
            RunId,
            EvaluatorId,
            max(EvaluatorName) AS EvaluatorName,
            avg(Score) AS avgScore,
            if(countIf(Passed IS NOT NULL) > 0, countIf(Passed = 1) / countIf(Passed IS NOT NULL), NULL) AS passRate,
            countIf(Passed IS NOT NULL) AS hasPassedCount
          FROM experiment_run_items
          ${buildDedupedRunItemsWhere({
            extraFilters: [
              "ResultType = 'evaluator'",
              "EvaluationStatus = 'processed'",
            ],
          })}
          GROUP BY ExperimentId, RunId, EvaluatorId
          LIMIT 10000
        `,
        query_params: {
          tenantId: projectId,
          runPairs,
          minOccurredAt: range.minOccurredAt,
          maxOccurredAt: range.maxOccurredAt,
        },
        format: "JSONEachRow",
      }),
      client.query({
        query: `
          SELECT
            ExperimentId,
            RunId,
            sumIf(TargetCost, ResultType = 'target') AS datasetCost,
            sumIf(EvaluationCost, ResultType = 'evaluator') AS evaluationsCost,
            avgIf(TargetCost, ResultType = 'target' AND TargetCost IS NOT NULL) AS datasetAverageCost,
            avgIf(TargetDurationMs, ResultType = 'target' AND TargetDurationMs IS NOT NULL) AS datasetAverageDuration,
            avgIf(EvaluationCost, ResultType = 'evaluator' AND EvaluationCost IS NOT NULL) AS evaluationsAverageCost,
            avgIf(EvaluationDurationMs, ResultType = 'evaluator' AND EvaluationDurationMs IS NOT NULL) AS evaluationsAverageDuration
          FROM experiment_run_items
          ${buildDedupedRunItemsWhere()}
          GROUP BY ExperimentId, RunId
          LIMIT 10000
        `,
        query_params: {
          tenantId: projectId,
          runPairs,
          minOccurredAt: range.minOccurredAt,
          maxOccurredAt: range.maxOccurredAt,
        },
        format: "JSONEachRow",
      }),
      this.versions(projectId, rows.flatMap((row) => row.WorkflowVersionId ? [row.WorkflowVersionId] : [])),
    ]);
    const [breakdowns, costs] = await Promise.all([breakdownResult.json<BreakdownRow>(), costResult.json<CostRow>()]);
    const byKey = <T extends { ExperimentId: string; RunId: string }>(
      values: T[],
    ) => new Map(values.map((value) => [runKey(value.ExperimentId, value.RunId), value]));
    const costsByKey = byKey(costs);
    const breakdownsByKey = new Map<string, BreakdownRow[]>();
    for (const value of breakdowns) {
      const key = runKey(value.ExperimentId, value.RunId);
      const existing = breakdownsByKey.get(key) ?? [];
      existing.push(value);
      breakdownsByKey.set(key, existing);
    }
    return rows.map((row) =>
      mapRun(
        row,
        versions[row.WorkflowVersionId ?? ""] ?? null,
        breakdownsByKey.get(runKey(row.ExperimentId, row.RunId)),
        costsByKey.get(runKey(row.ExperimentId, row.RunId)),
      ),
    );
  }

  private async versions(projectId: string, versionIds: string[]): Promise<Record<string, ExperimentRunWorkflowVersion>> {
    if (versionIds.length === 0) return {};
    const rows = await this.options.database.workflowVersion.findMany({
      where: { projectId, id: { in: [...new Set(versionIds)] } },
      select: {
        id: true,
        version: true,
        commitMessage: true,
        author: { select: { name: true, image: true } },
      },
    });
    return Object.fromEntries(rows.map((row) => [row.id, row]));
  }

  private async enrichItemCosts(
    client: ExperimentClickHouseClient,
    projectId: string,
    items: ItemRow[],
    range: { minOccurredAt: string; maxOccurredAt: string },
  ): Promise<ItemRow[]> {
    const traceIds = [
      ...new Set(
        items
          .filter(
            (item) =>
              item.ResultType === "target" &&
              item.TraceId &&
              item.TargetCost === null,
          )
          .flatMap((item) => (item.TraceId ? [item.TraceId] : [])),
      ),
    ];
    if (traceIds.length === 0) return items;

    try {
      const result = await client.query({
        query: `
          SELECT
            TraceId,
            TotalCost
          FROM trace_summaries
          WHERE TenantId = {tenantId:String}
            AND TraceId IN ({traceIds:Array(String)})
            AND OccurredAt >= {minOccurredAt:DateTime64(3)}
            AND OccurredAt <= {maxOccurredAt:DateTime64(3)}
            AND (TenantId, TraceId, UpdatedAt) IN (
              SELECT TenantId, TraceId, max(UpdatedAt)
              FROM trace_summaries
              WHERE TenantId = {tenantId:String}
                AND TraceId IN ({traceIds:Array(String)})
              GROUP BY TenantId, TraceId
            )
        `,
        query_params: {
          tenantId: projectId,
          traceIds,
          minOccurredAt: range.minOccurredAt,
          maxOccurredAt: range.maxOccurredAt,
        },
        format: "JSONEachRow",
      });
      const costs = new Map(
        (await result.json<{ TraceId: string; TotalCost: number | null }>())
          .flatMap((row) =>
            row.TotalCost && row.TotalCost > 0
              ? [[row.TraceId, row.TotalCost] as const]
              : [],
          ),
      );
      const counts = new Map<string, number>();
      for (const item of items) {
        if (item.ResultType === "target" && item.TraceId && costs.has(item.TraceId)) {
          counts.set(item.TraceId, (counts.get(item.TraceId) ?? 0) + 1);
        }
      }
      return items.map((item) => {
        if (
          !item.TraceId ||
          item.ResultType !== "target" ||
          item.TargetCost !== null ||
          !costs.has(item.TraceId)
        ) {
          return item;
        }
        return {
          ...item,
          TargetCost: Number(
            (costs.get(item.TraceId)! / (counts.get(item.TraceId) ?? 1)).toFixed(6),
          ),
        };
      });
    } catch (error) {
      this.options.telemetry.warn(
        { projectId, error },
        "Failed to enrich items with trace costs — returning items without costs",
      );
      return items;
    }
  }

  private warnIfRunsAreOld(projectId: string, minMs: number, runCount: number): void {
    const ageMs = Date.now() - minMs;
    if (ageMs <= WARN_OLD_RUN_AGE_MS) return;
    this.options.telemetry.warnOldRuns({
      projectId,
      oldestRunAgeDays: Math.floor(ageMs / (24 * 60 * 60 * 1000)),
      runCount,
      occurredAtBufferHours: OCCURRED_AT_BUFFER_MS / (60 * 60 * 1000),
    });
  }
}
function timestamps(row: RunRow) {
  const parse = (value: string): number =>
    new Date(`${value.replace(" ", "T")}Z`).getTime();
  return {
    createdAt: parse(row.CreatedAt),
    updatedAt: parse(row.UpdatedAt),
    finishedAt: row.FinishedAt ? parse(row.FinishedAt) : null,
    stoppedAt: row.StoppedAt ? parse(row.StoppedAt) : null,
  };
}

function mapRun(
  row: RunRow,
  workflowVersion: ExperimentRunWorkflowVersion | null,
  breakdown: BreakdownRow[] | undefined,
  costs: CostRow | undefined,
): ExperimentRun {
  const evaluations: ExperimentRun["summary"]["evaluations"] = {};
  for (const item of breakdown ?? []) {
    evaluations[item.EvaluatorId] = {
      name: item.EvaluatorName ?? item.EvaluatorId,
      averageScore: item.avgScore,
      ...(item.hasPassedCount > 0 && item.passRate !== null
        ? { averagePassed: item.passRate }
        : {}),
    };
  }
  return experimentRunSchema.parse({
    experimentId: row.ExperimentId,
    runId: row.RunId,
    workflowVersion,
    timestamps: timestamps(row),
    progress: row.Progress,
    total: row.Total,
    summary: {
      datasetCost: costs?.datasetCost ?? undefined,
      evaluationsCost: costs?.evaluationsCost ?? undefined,
      datasetAverageCost: costs?.datasetAverageCost ?? undefined,
      datasetAverageDuration: costs?.datasetAverageDuration ?? undefined,
      evaluationsAverageCost: costs?.evaluationsAverageCost ?? undefined,
      evaluationsAverageDuration: costs?.evaluationsAverageDuration ?? undefined,
      evaluations,
    },
  });
}

function mapRunWithItems(
  run: RunRow,
  items: ItemRow[],
  projectId: string,
): ExperimentRunWithItems {
  const dataset: ExperimentRunWithItems["dataset"] = [];
  const evaluations: ExperimentRunWithItems["evaluations"] = [];
  for (const item of items) {
    const targetId = item.TargetId && item.TargetId !== "default" ? item.TargetId : null;
    if (item.ResultType === "target") {
      const domainError = serializedHandledErrorSchema.safeParse(parseRecord(item.TargetDomainError));
      const predicted = parseRecord(item.Predicted);
      dataset.push({
        index: item.RowIndex,
        targetId,
        entry: parseRecord(item.DatasetEntry) ?? {},
        ...(predicted ? { predicted } : {}),
        cost: item.TargetCost,
        duration: item.TargetDurationMs,
        error: item.TargetError,
        ...(domainError.success ? { domainError: domainError.data } : {}),
        traceId: item.TraceId,
      });
    } else {
      evaluations.push({
        evaluator: item.EvaluatorId ?? "",
        name: item.EvaluatorName,
        targetId,
        status:
          item.EvaluationStatus === "processed" ||
          item.EvaluationStatus === "skipped"
            ? item.EvaluationStatus
            : "error",
        index: item.RowIndex,
        score: item.Score,
        label: item.Label,
        passed: item.Passed === null ? null : item.Passed === 1,
        details: item.EvaluationDetails,
        cost: item.EvaluationCost,
        inputs: parseRecord(item.EvaluationInputs) ?? null,
        duration: item.EvaluationDurationMs ?? null,
      });
    }
  }
  const targets = parseTargets(run.Targets);
  return experimentRunWithItemsSchema.parse({
    experimentId: run.ExperimentId,
    runId: run.RunId,
    projectId,
    workflowVersionId: run.WorkflowVersionId,
    progress: run.Progress,
    total: run.Total,
    targets,
    dataset,
    evaluations,
    timestamps: timestamps(run),
  });
}

function parseTargets(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    const targets = experimentRunTargetSchema.array().safeParse(parsed);
    return targets.success && targets.data.length > 0 ? targets.data : null;
  } catch {
    return null;
  }
}
