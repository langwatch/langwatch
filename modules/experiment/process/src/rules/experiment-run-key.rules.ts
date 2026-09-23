/**
 * Composite key helpers for experiment run aggregates. RunId slugs (e.g.
 * "hypnotic-persimmon-turkey") are NOT globally unique across experiments,
 * so `experimentId:runId` is the event-sourcing aggregate ID.
 */

export function makeExperimentRunKey(experimentId: string, runId: string): string {
  return `${experimentId}:${runId}`;
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
