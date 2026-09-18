import { Button } from "@chakra-ui/react";
import { Menu } from "@langwatch/design-system/menu";
import { MoreVertical } from "lucide-react";
import type React from "react";

import type { SessionListRow } from "./session-list-row.ts";

/**
 * Everything a reader can do with a row other than choose it — choosing
 * already opens the replay over the table, so the menu repeats that plus the
 * one destination the row can't reach: the full trace explorer page.
 */
export const SessionRowActions: React.FC<{
  row: SessionListRow;
  onOpenReplay: () => void;
  onOpenInExplorer: (() => void) | undefined;
}> = ({ row, onOpenReplay, onOpenInExplorer }) => (
  // The row itself opens the replay, so every control inside it has to stop
  // the click from reaching the row, or opening a menu would open a drawer
  // behind it.
  <div
    onClick={(event) => event.stopPropagation()}
    onKeyDown={(event) => event.stopPropagation()}
    role="presentation"
  >
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button
          size="xs"
          variant="ghost"
          aria-label={`Actions for ${row.title ?? "untitled session"}`}
        >
          <MoreVertical size={14} />
        </Button>
      </Menu.Trigger>
      <Menu.Content>
        <Menu.Item value="replay" onClick={onOpenReplay}>
          Open terminal replay
        </Menu.Item>
        {onOpenInExplorer ? (
          <Menu.Item value="explorer" onClick={onOpenInExplorer}>
            View on Trace Explorer
          </Menu.Item>
        ) : null}
      </Menu.Content>
    </Menu.Root>
  </div>
);
