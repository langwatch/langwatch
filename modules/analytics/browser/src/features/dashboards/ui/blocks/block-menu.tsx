/** A block's "⋮" menu on a member's board: Duplicate, Move to another dashboard, Delete. */

import { IconButton } from "@chakra-ui/react";
import { Menu } from "@langwatch/design-system/menu";
import { ArrowRightLeft, Copy, MoreVertical, Trash2 } from "lucide-react";

export function BlockMenu({
  title,
  otherBoards,
  disabled,
  onDuplicate,
  onMove,
  onDelete,
}: {
  title: string;
  /** The boards this block may move to; the current one is not among them. */
  otherBoards: readonly { id: string; name: string }[];
  disabled: boolean;
  onDuplicate: () => void;
  onMove: (dashboardId: string) => void;
  onDelete: () => void;
}) {
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <IconButton
          aria-label={`Actions for ${title}`}
          variant="ghost"
          size="xs"
          color="gray.400"
          disabled={disabled}
        >
          <MoreVertical size={14} />
        </IconButton>
      </Menu.Trigger>
      <Menu.Content>
        <Menu.Item value="duplicate" onClick={onDuplicate}>
          <Copy size={14} /> Duplicate
        </Menu.Item>
        {otherBoards.length > 0 && (
          <Menu.ItemGroup title="Move to">
            {otherBoards.map((board) => (
              <Menu.Item key={board.id} value={`move-${board.id}`} onClick={() => onMove(board.id)}>
                <ArrowRightLeft size={14} /> {board.name}
              </Menu.Item>
            ))}
          </Menu.ItemGroup>
        )}
        <Menu.Item value="delete" color="fg.error" onClick={onDelete}>
          <Trash2 size={14} /> Delete
        </Menu.Item>
      </Menu.Content>
    </Menu.Root>
  );
}
