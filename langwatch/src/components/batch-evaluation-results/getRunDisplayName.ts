/**
 * Returns a human-readable display name for a batch evaluation run.
 *
 * Prefers the workflow version commit message when available.
 * Falls back to "Run #N" (1-based) based on the run's chronological index.
 */
export function getRunDisplayName({
  commitMessage,
  index,
}: {
  commitMessage: string | null | undefined;
  index: number;
}): string {
  if (commitMessage) {
    return commitMessage;
  }
  return `Run #${index + 1}`;
}
