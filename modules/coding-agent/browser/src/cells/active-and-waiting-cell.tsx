import { Text, VStack } from "@langwatch/design-system/primitives";
import type React from "react";

import type { SessionListRow } from "../behavior/session-list-row.ts";
import { formatDurationSeconds } from "../model/duration.ts";
import { MissingValue } from "../ui/elements/cells/missing-value.tsx";

/**
 * How long the agent worked against how long it stood waiting on its human.
 * Both figures are peers at the same size; only colour tells them apart, so a
 * row showing one of them lines up with a row showing the other.
 */
export const ActiveAndWaitingCell: React.FC<{ row: SessionListRow }> = ({ row }) => {
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
        <Text fontSize="sm" color="fg.muted" whiteSpace="nowrap">
          {formatDurationSeconds(waitingSeconds)} waiting
        </Text>
      ) : null}
    </VStack>
  );
};
