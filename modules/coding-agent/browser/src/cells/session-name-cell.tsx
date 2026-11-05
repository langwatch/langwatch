import { chakra, HStack, Spinner, Text, VStack } from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";
import type React from "react";

import type { SessionListRow } from "../behavior/session-list-row.ts";

// Session name and branch; untitled sessions show branch (work identifier);
// name is keyboard-focusable control for replay. A group project's rows also
// name the member project that recorded each session.
export const SessionNameCell: React.FC<{
  row: SessionListRow;
  showProject?: boolean;
  isOpening: boolean;
  onOpenReplay?: (() => void) | undefined;
}> = ({ row, showProject = false, isOpening, onOpenReplay }) => {
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
      {showProject ? (
        <Text
          fontSize="xs"
          color="fg.muted"
          truncate
          maxWidth="full"
          title={`Member project: ${row.projectName}`}
          data-testid="coding-agent-session-project"
        >
          {row.projectName}
        </Text>
      ) : null}
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
 * The name as the control that opens the replay, drawn as plain text since
 * the whole row already reads as clickable. Stops the click reaching the row
 * underneath so replay is asked for once, not twice; nothing to open renders no control.
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
