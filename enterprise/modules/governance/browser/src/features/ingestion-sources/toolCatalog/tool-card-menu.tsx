// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { Button } from "@chakra-ui/react";
import { Menu } from "@langwatch/design-system/menu";
import { MoreVertical, Pencil, Power, Trash2 } from "lucide-react";

import type { ToolCard } from "./tool-cards";

/** One trailing overflow menu for both layouts (dev/docs/best_practices/row-actions-overflow-menu.md). */
export function ToolCardMenu({
  card,
  onEdit,
  onTogglePublished,
  onRemove,
  isTogglePending,
}: {
  card: ToolCard;
  onEdit: (card: ToolCard) => void;
  onTogglePublished: (card: ToolCard) => void;
  onRemove: (card: ToolCard) => void;
  isTogglePending: boolean;
}) {
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button size="xs" variant="ghost" aria-label={`Actions for ${card.name}`}>
          <MoreVertical size={14} />
        </Button>
      </Menu.Trigger>
      <Menu.Content>
        <Menu.Item
          value="edit"
          onClick={(event) => {
            event.stopPropagation();
            onEdit(card);
          }}
        >
          <Pencil size={14} /> Edit
        </Menu.Item>
        <Menu.Item
          value="publish"
          disabled={isTogglePending}
          onClick={(event) => {
            event.stopPropagation();
            onTogglePublished(card);
          }}
        >
          {/* "Published": whether members can reach the tool from their own portal. */}
          <Power size={14} /> {card.enabled ? "Unpublish" : "Publish"}
        </Menu.Item>
        <Menu.Item
          value="remove"
          color="red.500"
          onClick={(event) => {
            event.stopPropagation();
            onRemove(card);
          }}
        >
          <Trash2 size={14} /> Remove
        </Menu.Item>
      </Menu.Content>
    </Menu.Root>
  );
}
