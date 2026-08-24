/**
 * Query helpers shared by the Experiment run-history ClickHouse repository.
 *
 * The item tables are partitioned by week. Keep the lifecycle-derived
 * OccurredAt bounds and exact experiment/run pairs in every multi-run read so
 * ClickHouse can prune partitions without treating reused run ids as matches.
 */

export const OCCURRED_AT_BUFFER_MS = 24 * 60 * 60 * 1000;
export const WARN_OLD_RUN_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const RUN_ITEMS_DEDUP_KEY =
  "TenantId, ExperimentId, RunId, RowIndex, TargetId, ResultType, coalesce(EvaluatorId, '')";

const RUN_ITEMS_SCOPE = `TenantId = {tenantId:String}
          AND OccurredAt >= {minOccurredAt:DateTime64(3)}
          AND OccurredAt <= {maxOccurredAt:DateTime64(3)}
          AND (ExperimentId, RunId) IN {runPairs:Array(Tuple(String, String))}`;

export function buildDedupedRunItemsWhere({
  extraFilters = [],
}: {
  extraFilters?: string[];
} = {}): string {
  const extra = extraFilters
    .map((filter) => `\n          AND ${filter}`)
    .join("");

  return `WHERE ${RUN_ITEMS_SCOPE}${extra}
          AND (${RUN_ITEMS_DEDUP_KEY}, OccurredAt) IN (
            SELECT
              ${RUN_ITEMS_DEDUP_KEY},
              max(OccurredAt)
            FROM experiment_run_items
            WHERE ${RUN_ITEMS_SCOPE}
            GROUP BY ${RUN_ITEMS_DEDUP_KEY}
          )`;
}

export function computeOccurredAtRangeForRuns(
  runs: Array<{ CreatedAt: string; UpdatedAt: string }>,
): { minOccurredAt: string; maxOccurredAt: string; minMs: number } {
  if (runs.length === 0) {
    throw new Error(
      "computeOccurredAtRangeForRuns called with no runs; caller must guard",
    );
  }

  let minMs = Infinity;
  let maxMs = -Infinity;
  for (const run of runs) {
    minMs = Math.min(minMs, parseClickHouseDateTime(run.CreatedAt));
    maxMs = Math.max(maxMs, parseClickHouseDateTime(run.UpdatedAt));
  }

  return {
    minOccurredAt: formatClickHouseDateTime(minMs - OCCURRED_AT_BUFFER_MS),
    maxOccurredAt: formatClickHouseDateTime(maxMs + OCCURRED_AT_BUFFER_MS),
    minMs,
  };
}

function formatClickHouseDateTime(milliseconds: number): string {
  return new Date(milliseconds)
    .toISOString()
    .replace("T", " ")
    .replace("Z", "");
}

function parseClickHouseDateTime(value: string): number {
  return new Date(`${value.replace(" ", "T")}Z`).getTime();
}
