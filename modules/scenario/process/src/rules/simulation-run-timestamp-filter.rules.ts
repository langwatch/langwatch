/**
 * Which runs of a batch a conditional fetch still has to send. The client
 * holds a per-run timestamp map from its last answer; a run already held at
 * the same version is dropped, so a poll answers with only what moved.
 */
import type { SimulationBatchRunData } from "@langwatch/scenario-contract";

/**
 * Filters runs by per-run timestamps so only changed runs are returned. With
 * no `runTimestamps` the result travels unchanged, which is what a client that
 * holds nothing yet asks for.
 */
export function filterRunsByTimestamp(
  result: SimulationBatchRunData,
  runTimestamps?: Record<string, number>,
): SimulationBatchRunData {
  if (!result.changed || !runTimestamps) return result;

  const filtered = result.runs.filter((run) => {
    const clientTimestamp = runTimestamps[run.scenarioRunId];
    // A run the client does not hold, or one updated since it last asked.
    const runUpdatedAt = run.updatedAt ?? run.timestamp;

    return clientTimestamp === undefined || runUpdatedAt > clientTimestamp;
  });

  if (filtered.length === 0) {
    return { changed: false as const, lastUpdatedAt: result.lastUpdatedAt };
  }

  return { changed: true as const, lastUpdatedAt: result.lastUpdatedAt, runs: filtered };
}
