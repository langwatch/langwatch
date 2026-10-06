/** A widget's "⋮" menu on a board: Edit, Duplicate, Delete. */

import { Menu } from "@langwatch/design-system/menu";
import { IconButton } from "@langwatch/design-system/primitives";
import { Copy, MoreVertical, Pencil, Trash2 } from "lucide-react";

export function WidgetMenu({
  name,
  disabled,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  name: string;
  disabled: boolean;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <IconButton
          aria-label={`Actions for ${name}`}
          variant="ghost"
          size="xs"
          color="fg.subtle"
          _hover={{ color: "fg", background: "bg.muted" }}
          disabled={disabled}
        >
          <MoreVertical size={14} aria-hidden />
        </IconButton>
      </Menu.Trigger>
      <Menu.Content>
        <Menu.Item value="edit" onClick={onEdit}>
          <Pencil size={14} /> Edit
        </Menu.Item>
        <Menu.Item value="duplicate" onClick={onDuplicate}>
          <Copy size={14} /> Duplicate
        </Menu.Item>
        <Menu.Item value="delete" color="fg.error" onClick={onDelete}>
          <Trash2 size={14} /> Delete
        </Menu.Item>
      </Menu.Content>
    </Menu.Root>
  );
}
