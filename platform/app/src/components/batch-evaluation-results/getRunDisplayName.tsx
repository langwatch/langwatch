import { Text } from "@chakra-ui/react";

/** Gray middle-dot separator between the run index and its generated id. */
const RUN_NAME_SEPARATOR = " · ";

/**
 * Returns a plain string display name for a batch evaluation run.
 *
 * Prefers the workflow version commit message when available.
 * Falls back to "Run #N · runId" (1-based) based on the run's chronological
 * index. The full run id is kept (no hard truncation) so tooltips and chart
 * labels stay unambiguous; visible UI clips overflow via layout, not by
 * mangling the string here.
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

/**
 * Rich rendering of a run display name, showing the run id after a gray
 * middle-dot separator when no commit message is available.
 *
 * Use this component in UI contexts where ReactNode rendering is supported
 * (e.g. the runs sidebar). For chart labels, axis ticks, or other
 * string-only contexts, use getRunDisplayName() instead. Overflow is left to
 * the surrounding layout (lineClamp/ellipsis) so the full name stays intact.
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
      {`Run #${index + 1}`}
      <Text as="span" color="fg.muted" title={runId}>
        {`${RUN_NAME_SEPARATOR}${runId}`}
      </Text>
    </Text>
  );
}
