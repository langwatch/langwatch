import { Text } from "@chakra-ui/react";

/** Gray middle-dot separator between the run index and its generated id. */
const RUN_NAME_SEPARATOR = " · ";

/**
 * Rich app presentation for a run display name.
 *
 * String construction belongs to Experiment web. This adapter only gives the
 * generated id muted Chakra styling when there is no commit message.
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
