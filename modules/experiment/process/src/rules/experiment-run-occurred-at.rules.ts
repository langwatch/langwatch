/** How far either side of a run's first and last write its items and traces are read. */
export const OCCURRED_AT_BUFFER_MS = 24 * 60 * 60 * 1000;

/** The epoch-ms window a run's traces are read in, a buffer either side of its writes. */
export function runOccurredAtWindow({
  createdAt,
  updatedAt,
}: {
  createdAt: number;
  updatedAt: number;
}): { from: number; to: number } {
  return { from: createdAt - OCCURRED_AT_BUFFER_MS, to: updatedAt + OCCURRED_AT_BUFFER_MS };
}
