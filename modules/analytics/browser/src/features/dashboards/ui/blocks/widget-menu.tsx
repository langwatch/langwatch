/**
 * A widget's "⋮" menu on a board: Edit, Duplicate, then Set an alert and Send as a report
 * when Langy is available (alerts and reports are actions on a widget), then Delete.
 */

import { Menu } from "@langwatch/design-system/menu";
import { IconButton } from "@langwatch/design-system/primitives";
import { Bell, Copy, MoreVertical, Pencil, Send, Trash2 } from "lucide-react";

export function WidgetMenu({
  name,
  disabled,
  onEdit,
  onDuplicate,
  onSetAlert,
  onSendReport,
  onDelete,
}: {
  name: string;
  disabled: boolean;
  onEdit: () => void;
  onDuplicate: () => void;
  /** Drafts an alert on this widget in Langy; absent when Langy is not available. */
  onSetAlert?: () => void;
  /** Drafts a scheduled report of this widget in Langy; absent when Langy is not available. */
  onSendReport?: () => void;
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
        {onSetAlert && (
          <Menu.Item value="alert" onClick={onSetAlert}>
            <Bell size={14} /> Set an alert
          </Menu.Item>
        )}
        {onSendReport && (
          <Menu.Item value="report" onClick={onSendReport}>
            <Send size={14} /> Send as a report
          </Menu.Item>
        )}
        <Menu.Item value="delete" color="fg.error" onClick={onDelete}>
          <Trash2 size={14} /> Delete
        </Menu.Item>
      </Menu.Content>
    </Menu.Root>
  );
}
