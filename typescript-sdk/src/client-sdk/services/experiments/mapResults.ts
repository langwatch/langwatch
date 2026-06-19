/**
 * Maps the platform `/runs/{runId}/results` response (ExperimentRunWithItems)
 * into per-row results.
 *
 * Mirrors the python SDK's `_build_df_from_platform`: dataset entries become the
 * base rows (one per entry, i.e. one per target in multi-target runs), and
 * evaluations are joined onto those rows on `(index, targetId)`.
 */

import type { ExperimentRunResultsResponse } from "./experiments-api.service";
import type { ExperimentRowResult } from "./platformTypes";

const matchesRow = ({
  row,
  index,
  targetId,
}: {
  row: ExperimentRowResult;
  index: number;
  targetId?: string | null;
}): boolean => {
  if (row.index !== index) return false;
  // Only constrain on target when the evaluation carries one and the rows are
  // multi-target (rows carry a `target`). Single-target rows have no `target`,
  // so an evaluation targetId should not exclude them.
  if (targetId && row.target !== undefined) {
    return row.target === targetId;
  }
  return true;
};

export const mapRunResultsToRows = (
  response: ExperimentRunResultsResponse,
): ExperimentRowResult[] => {
  const datasetEntries = response.dataset ?? [];
  const evaluations = response.evaluations ?? [];

  const rows: ExperimentRowResult[] = datasetEntries.map((entry) => {
    const entryData =
      entry.entry && typeof entry.entry === "object" ? entry.entry : {};

    const predicted = entry.predicted;
    const output =
      predicted && typeof predicted === "object" && "output" in predicted
        ? (predicted as Record<string, unknown>).output
        : predicted;

    const row: ExperimentRowResult = {
      index: entry.index ?? 0,
      input: { ...entryData },
      output,
      traceId: entry.traceId ?? "",
      evaluations: {},
    };

    if (entry.cost != null) row.cost = entry.cost;
    if (entry.duration != null) row.duration = entry.duration;
    if (entry.error) row.error = entry.error;
    if (entry.targetId) row.target = entry.targetId;

    return row;
  });

  for (const evaluation of evaluations) {
    const index = evaluation.index;
    const name = evaluation.name || evaluation.evaluator;
    if (index == null || !name) continue;

    for (const row of rows) {
      if (!matchesRow({ row, index, targetId: evaluation.targetId })) continue;

      const metric = row.evaluations[name] ?? {};
      if (evaluation.score != null) metric.score = evaluation.score;
      if (evaluation.passed != null) metric.passed = evaluation.passed;
      row.evaluations[name] = metric;
    }
  }

  return rows;
};
