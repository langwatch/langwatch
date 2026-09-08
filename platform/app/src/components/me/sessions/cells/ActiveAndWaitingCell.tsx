import { Text, VStack } from "@chakra-ui/react";
import type React from "react";

import { formatDurationSeconds } from "../../duration";
import type { SessionListRow } from "../sessionListRow";
import { MissingValue } from "./MissingValue";

/**
 * How long the agent worked against how long it stood waiting on its human.
 * The second figure is usually the one nobody had measured, and it is what
 * turns "the session took all afternoon" into something actionable.
 */
export const ActiveAndWaitingCell: React.FC<{ row: SessionListRow }> = ({
  row,
}) => {
  const waitingSeconds = row.blockedOnUserMs / 1000;
  if (row.activeTimeCliSec === 0 && waitingSeconds === 0) {
    return <MissingValue />;
  }

  return (
    <VStack align="start" gap={0}>
      {row.activeTimeCliSec > 0 ? (
        <Text fontSize="sm" whiteSpace="nowrap">
          {formatDurationSeconds(row.activeTimeCliSec)} active
        </Text>
      ) : null}
      {waitingSeconds > 0 ? (
        <Text fontSize="xs" color="fg.muted" whiteSpace="nowrap">
          {formatDurationSeconds(waitingSeconds)} waiting
        </Text>
      ) : null}
    </VStack>
  );
};
