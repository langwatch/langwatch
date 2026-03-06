/**
 * Suite run composite key utilities.
 * The aggregate ID for suite runs is a composite of suiteId and batchRunId.
 */

const SEPARATOR = ":";

export function makeSuiteRunKey(suiteId: string, batchRunId: string): string {
  return `${suiteId}${SEPARATOR}${batchRunId}`;
}

export function parseSuiteRunKey(key: string): { suiteId: string; batchRunId: string } {
  const idx = key.indexOf(SEPARATOR);
  if (idx === -1) {
    throw new Error(`Invalid suite run key: ${key}`);
  }
  return {
    suiteId: key.slice(0, idx),
    batchRunId: key.slice(idx + 1),
  };
}
