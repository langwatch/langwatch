import { Text } from "@chakra-ui/react";
import React from "react";

/**
 * Returns a human-readable display name for a batch evaluation run.
 *
 * Prefers the workflow version commit message when available.
 * Falls back to "Run #N" (1-based) based on the run's chronological index, along
 * with the experiment run id.
 */
export function getRunDisplayName({
  commitMessage,
  runId,
  index,
}: {
  commitMessage: string | null | undefined;
  runId: string;
  index: number;
}): React.ReactNode | string {
  if (commitMessage) {
    return commitMessage;
  }

  if (!runId) {
    return `Run #${index + 1} / ${runId}`;
  }

  return (
    <Text>
      {`#${index + 1}`}
      <Text display="inline" textStyle="xs" color="fg.muted">
        {` // ${runId}`}
      </Text>
    </Text>
  )
}
