import { chakra, HStack, Spinner, Text, VStack } from "@chakra-ui/react";
import type { SessionListRow } from "../session-list-row.ts";
import type React from "react";

import { Tooltip } from "@langwatch/design-system/tooltip";

// Session name and branch; untitled sessions show branch (work identifier);
// name is keyboard-focusable control for replay.
export const SessionNameCell: React.FC<{
  row: SessionListRow;
  isOpening: boolean;
  onOpenReplay?: (() => void) | undefined;
}> = ({ row, isOpening, onOpenReplay }) => {
  const where = [row.repositoryFullName, row.gitBranch].filter((part) => part !== "").join(" · ");

  return (
    // The column is capped, so both lines have to be told they may not grow
    // past it: a column flex box sizes its children to their content, which
    // lets a long branch name run under the next column instead of ellipsing.
    <VStack align="start" gap={0} minWidth={0} width="full">
      <HStack gap={2} minWidth={0} width="full">
        <SessionNameButton onOpenReplay={onOpenReplay} label={row.title ?? "untitled session"}>
          {row.title ? (
            <Text fontSize="sm" fontWeight="medium" truncate>
              {row.title}
            </Text>
          ) : (
            <Text fontSize="sm" color="fg.muted" truncate>
              Untitled session
            </Text>
          )}
        </SessionNameButton>
        {isOpening ? <Spinner size="xs" color="fg.muted" flexShrink={0} /> : null}
      </HStack>
      {where === "" ? null : (
        <Tooltip content={where} positioning={{ placement: "bottom-start" }}>
          <Text fontSize="xs" color="fg.subtle" fontFamily="mono" truncate maxWidth="full">
            {where}
          </Text>
        </Tooltip>
      )}
    </VStack>
  );
};

/**
 * The name as the control that opens the replay, drawn as plain text because
 * the whole row already reads as clickable. It stops the click from reaching
 * the row underneath so the replay is asked for once rather than twice, and
 * a row with nothing to open renders the name and no control at all.
 */
const SessionNameButton: React.FC<{
  onOpenReplay: (() => void) | undefined;
  label: string;
  children: React.ReactNode;
}> = ({ onOpenReplay, label, children }) => {
  if (!onOpenReplay) return <>{children}</>;

  return (
    <chakra.button
      type="button"
      aria-label={`Open the terminal replay of ${label}`}
      onClick={(event) => {
        event.stopPropagation();
        onOpenReplay();
      }}
      minWidth={0}
      textAlign="start"
      bg="transparent"
      border="none"
      padding={0}
      cursor="pointer"
      color="inherit"
      font="inherit"
    >
      {children}
    </chakra.button>
  );
};
