/**
 * Composite key helpers for experiment run aggregates. RunId slugs (e.g.
 * "hypnotic-persimmon-turkey") are NOT globally unique across experiments,
 * so `experimentId:runId` is the event-sourcing aggregate ID.
 */

export function makeExperimentRunKey(experimentId: string, runId: string): string {
  return hasExperiment(experimentId) ? `${experimentId}:${runId}` : runId;
}

/** A run without an experiment (execute's is optional) is keyed by runId alone, ARCHITECTURE §9. */
export function hasExperiment(experimentId: string): boolean {
  return experimentId !== "";
}

export function parseExperimentRunKey(compositeKey: string): {
  experimentId: string;
  runId: string;
} {
  const i = compositeKey.indexOf(":");
  if (i === -1) return { experimentId: "", runId: compositeKey };
  return {
    experimentId: compositeKey.substring(0, i),
    runId: compositeKey.substring(i + 1),
  };
}
