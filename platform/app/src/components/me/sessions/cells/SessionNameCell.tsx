import { HStack, Spinner, Text, VStack } from "@chakra-ui/react";
import type React from "react";

import { Tooltip } from "~/components/ui/tooltip";

import type { SessionListRow } from "../sessionListRow";

/**
 * What the session was called, over where it ran.
 *
 * A session whose agent never named it, and one whose title this reader may
 * not see, both read as untitled: the row is still worth listing for what it
 * consumed, and the branch under it says which piece of work it was.
 */
export const SessionNameCell: React.FC<{
  row: SessionListRow;
  isOpening: boolean;
}> = ({ row, isOpening }) => {
  const where = [row.repositoryFullName, row.gitBranch]
    .filter((part) => part !== "")
    .join(" · ");

  return (
    // The column is capped, so both lines have to be told they may not grow
    // past it: a column flex box sizes its children to their content, which
    // lets a long branch name run under the next column instead of ellipsing.
    <VStack align="start" gap={0} minWidth={0} width="full">
      <HStack gap={2} minWidth={0} width="full">
        {row.title ? (
          <Text fontSize="sm" fontWeight="medium" truncate>
            {row.title}
          </Text>
        ) : (
          <Text fontSize="sm" color="fg.muted" truncate>
            Untitled session
          </Text>
        )}
        {isOpening ? (
          <Spinner size="xs" color="fg.muted" flexShrink={0} />
        ) : null}
      </HStack>
      {where === "" ? null : (
        <Tooltip content={where} positioning={{ placement: "bottom-start" }}>
          <Text
            fontSize="xs"
            color="fg.subtle"
            fontFamily="mono"
            truncate
            maxWidth="full"
          >
            {where}
          </Text>
        </Tooltip>
      )}
    </VStack>
  );
};
