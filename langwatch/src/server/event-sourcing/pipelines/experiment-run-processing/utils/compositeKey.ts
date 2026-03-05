/**
 * Composite key helpers for experiment run aggregates.
 *
 * RunId slugs (e.g. "hypnotic-persimmon-turkey") are NOT globally unique —
 * the same slug can appear across different experiments. The composite key
 * `experimentId:runId` is used as the event-sourcing aggregate ID to
 * guarantee uniqueness.
 */

export function makeExperimentRunKey(
  experimentId: string,
  runId: string,
): string {
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
