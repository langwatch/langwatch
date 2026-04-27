import { Text } from "@chakra-ui/react";

function truncateRunId(runId: string, maxLength = 8): string {
  return runId.length > maxLength ? `${runId.slice(0, maxLength)}…` : runId;
}

/**
 * Returns a plain string display name for a batch evaluation run.
 *
 * Prefers the workflow version commit message when available.
 * Falls back to "Run #N (runId)" (1-based) based on the run's chronological index.
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
    return `Run #${index + 1} (${truncateRunId(runId)})`;
  }

  return `Run #${index + 1}`;
}

/**
 * Rich rendering of a run display name, showing the run ID
 * in a muted style when no commit message is available.
 *
 * Use this component in UI contexts where ReactNode rendering is supported.
 * For chart labels, axis ticks, or other string-only contexts, use getRunDisplayName() instead.
 */
export function RunDisplayName({
  commitMessage,
  runId,
  index,
}: {
  commitMessage: string | null | undefined;
  runId: string;
  index: number;
}) {
  if (commitMessage) {
    return <>{commitMessage}</>;
  }

  return (
    <Text as="span">
      {`#${index + 1}`}
      <Text as="span" textStyle="xs" color="fg.muted" title={runId}>
        {` // ${truncateRunId(runId)}`}
      </Text>
    </Text>
  );
}
