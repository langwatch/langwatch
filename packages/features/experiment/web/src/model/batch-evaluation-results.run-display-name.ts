/** Gray middle-dot separator between the run index and its generated id. */
const RUN_NAME_SEPARATOR = " · ";

/**
 * Returns a plain string display name for a batch evaluation run.
 *
 * Prefers the workflow version commit message. Otherwise uses the 1-based
 * chronological index and, when present, the untruncated run id.
 */
export function getRunDisplayName({
  commitMessage,
  runId,
  index,
}: {
  commitMessage: string | null | undefined;
  runId?: string;
  index: number;
}): string {
  if (commitMessage) {
    return commitMessage;
  }

  if (runId) {
    return `Run #${index + 1}${RUN_NAME_SEPARATOR}${runId}`;
  }

  return `Run #${index + 1}`;
}
