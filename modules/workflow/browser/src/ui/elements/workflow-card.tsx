import { Link } from "@langwatch/browser-host/link";
import { Menu } from "@langwatch/design-system/menu";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { WORKFLOW_CARD_OPENER_STYLE } from "@langwatch/design-system/workflow-card";
import { ArrowUp, Copy, MoreVertical, RefreshCw, Trash2 } from "react-feather";

/** A card opener that navigates rather than acts. */
export function WorkflowCardLink({
  label,
  ...props
}: { label: string } & Omit<React.ComponentProps<typeof Link>, "children">) {
  return <Link aria-label={label} {...WORKFLOW_CARD_OPENER_STYLE} {...props} />;
}

export function WorkflowCardActions({
  isCopy,
  hasCopies,
  sourceProjectPath,
  onSyncFromSource,
  onPushToCopies,
  onCopy,
  onDelete,
}: {
  isCopy: boolean;
  hasCopies: boolean;
  sourceProjectPath?: string;
  onSyncFromSource: () => void;
  onPushToCopies: () => void;
  onCopy: () => void;
  onDelete: () => void;
}) {
  return (
    <Menu.Root>
      <Menu.Trigger className="js-inner-menu" aria-label="Workflow actions">
        <MoreVertical size={16} />
      </Menu.Trigger>
      <Menu.Content className="js-inner-menu">
        {isCopy && (
          <Tooltip
            content={sourceProjectPath ? `Copied from: ${sourceProjectPath}` : undefined}
            disabled={!sourceProjectPath}
            positioning={{ placement: "right" }}
            showArrow
          >
            <Menu.Item value="sync" onClick={onSyncFromSource}>
              <RefreshCw size={16} /> Update from source
            </Menu.Item>
          </Tooltip>
        )}
        {hasCopies && (
          <Menu.Item value="push" onClick={onPushToCopies}>
            <ArrowUp size={16} /> Push to replicas
          </Menu.Item>
        )}
        <Menu.Item value="copy" onClick={onCopy}>
          <Copy size={16} /> Replicate to another project
        </Menu.Item>
        <Menu.Item value="delete" color="red.fg" onClick={onDelete}>
          <Trash2 size={16} /> Delete
        </Menu.Item>
      </Menu.Content>
    </Menu.Root>
  );
}
