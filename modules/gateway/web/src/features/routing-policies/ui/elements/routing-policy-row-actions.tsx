import { Button } from "@chakra-ui/react";
import { MoreVertical } from "lucide-react";

import { Menu } from "@langwatch/design-system/menu";

/**
 * The per-row overflow menu (see
 * dev/docs/best_practices/row-actions-overflow-menu.md). One trigger per row,
 * destructive action tinted and one deliberate click away.
 */
export function RoutingPolicyRowActions({
  policyName,
  isDefault,
  onEdit,
  onSetDefault,
  onDelete,
}: {
  policyName: string;
  isDefault: boolean;
  onEdit: () => void;
  onSetDefault: () => void;
  onDelete: () => void;
}) {
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button size="xs" variant="ghost" aria-label={`Actions for ${policyName}`}>
          <MoreVertical size={14} />
        </Button>
      </Menu.Trigger>
      <Menu.Content>
        <Menu.Item
          value="edit"
          onClick={(event) => {
            event.stopPropagation();
            onEdit();
          }}
        >
          Edit
        </Menu.Item>
        {!isDefault && (
          <Menu.Item
            value="set-default"
            onClick={(event) => {
              event.stopPropagation();
              onSetDefault();
            }}
          >
            Make default
          </Menu.Item>
        )}
        <Menu.Item
          value="delete"
          color="red.500"
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
        >
          Delete
        </Menu.Item>
      </Menu.Content>
    </Menu.Root>
  );
}
