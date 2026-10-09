/**
 * A widget's "⋮" menu on a board, in the prototype's order: edit it (with Langy, or its code),
 * copy its id or the API call that edits it, then Set an alert and Send as a report, then
 * Duplicate and Delete. The Langy actions show only when Langy is available.
 */

import { Menu } from "@langwatch/design-system/menu";
import { IconButton } from "@langwatch/design-system/primitives";
import {
  BellPlus,
  Braces,
  Code2,
  Copy,
  Hash,
  MoreVertical,
  Send,
  Sparkles,
  Trash2,
} from "lucide-react";

export function WidgetMenu({
  name,
  disabled,
  onEditWithLangy,
  onEditCode,
  onCopyId,
  onCopyApiSnippet,
  onSetAlert,
  onSendReport,
  onDuplicate,
  onDelete,
}: {
  name: string;
  disabled: boolean;
  /** Opens the editor with an edit drafted in Langy; absent when Langy is not available. */
  onEditWithLangy?: () => void;
  /** Absent when the reader may not see the widget's data and may not edit widgets either. */
  onEditCode?: () => void;
  onCopyId: () => void;
  onCopyApiSnippet: () => void;
  /** Drafts an alert on this widget in Langy; absent when Langy is not available. */
  onSetAlert?: () => void;
  /** Drafts a scheduled report of this widget in Langy; absent when Langy is not available. */
  onSendReport?: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  return (
    <Menu.Root positioning={{ placement: "bottom-end" }}>
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
      <Menu.Content minWidth="200px">
        {onEditWithLangy && (
          <Menu.Item value="edit-langy" onClick={onEditWithLangy}>
            <Sparkles size={14} /> Edit with Langy
          </Menu.Item>
        )}
        {onEditCode && (
          <Menu.Item value="edit-code" onClick={onEditCode}>
            <Code2 size={14} /> Edit code
          </Menu.Item>
        )}
        <Menu.Item value="copy-id" onClick={onCopyId}>
          <Hash size={14} /> Copy widget id
        </Menu.Item>
        <Menu.Item value="copy-api" onClick={onCopyApiSnippet}>
          <Braces size={14} /> Copy API snippet
        </Menu.Item>
        {(onSetAlert || onSendReport) && <Menu.Separator />}
        {onSetAlert && (
          <Menu.Item value="alert" onClick={onSetAlert}>
            <BellPlus size={14} /> Set an alert
          </Menu.Item>
        )}
        {onSendReport && (
          <Menu.Item value="report" onClick={onSendReport}>
            <Send size={14} /> Send as a report
          </Menu.Item>
        )}
        <Menu.Separator />
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
