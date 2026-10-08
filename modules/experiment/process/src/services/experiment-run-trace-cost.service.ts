import type { ExperimentRunWithItems } from "@langwatch/experiment-contract";
import { createLogger } from "@langwatch/observability";
import type { TraceApi } from "@langwatch/trace-contract";

import { runOccurredAtWindow } from "../rules/experiment-run-occurred-at.rules.ts";

const logger = createLogger("langwatch:experiment:run-trace-cost");

type DatasetRow = ExperimentRunWithItems["dataset"][number];

const isUnpriced = (row: DatasetRow): boolean => row.cost === null || row.cost === undefined;

/**
 * Fills a target row that recorded no cost from its trace's settled cost, split evenly across
 * the rows sharing that trace. Trace owns the cost; a failed read leaves the rows unpriced.
 */
export class ExperimentRunTraceCostService {
  static create(options: {
    traces: Pick<TraceApi, "findTraceCosts">;
  }): ExperimentRunTraceCostService {
    return new ExperimentRunTraceCostService(options.traces);
  }

  private constructor(private readonly traces: Pick<TraceApi, "findTraceCosts">) {}

  async priceRows(run: ExperimentRunWithItems): Promise<ExperimentRunWithItems> {
    const traceIds = [
      ...new Set(
        run.dataset.flatMap((row) => (row.traceId && isUnpriced(row) ? [row.traceId] : [])),
      ),
    ];
    if (traceIds.length === 0) return run;

    const costs = await this.findPositiveCosts({ run, traceIds });
    if (costs.size === 0) return run;

    const rowsPerTrace = new Map<string, number>();
    for (const row of run.dataset) {
      if (row.traceId && costs.has(row.traceId)) {
        rowsPerTrace.set(row.traceId, (rowsPerTrace.get(row.traceId) ?? 0) + 1);
      }
    }
    return {
      ...run,
      dataset: run.dataset.map((row) => {
        const cost = row.traceId ? costs.get(row.traceId) : undefined;
        if (!row.traceId || !isUnpriced(row) || cost === undefined) return row;
        const share = cost / (rowsPerTrace.get(row.traceId) ?? 1);
        return { ...row, cost: Number(share.toFixed(6)) };
      }),
    };
  }

  private async findPositiveCosts({
    run,
    traceIds,
  }: {
    run: ExperimentRunWithItems;
    traceIds: string[];
  }): Promise<Map<string, number>> {
    try {
      const costs = await this.traces.findTraceCosts({
        projectId: run.projectId,
        traceIds,
        occurredAt: runOccurredAtWindow(run.timestamps),
      });
      return new Map(
        costs.flatMap(({ traceId, totalCost }) =>
          totalCost !== null && totalCost > 0 ? [[traceId, totalCost] as const] : [],
        ),
      );
    } catch (error) {
      logger.warn(
        { projectId: run.projectId, error },
        "Failed to enrich items with trace costs — returning items without costs",
      );
      return new Map();
    }
  }
}
