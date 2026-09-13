// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { Button } from "@chakra-ui/react";
import { MoreVertical, Pencil, Power, Trash2 } from "lucide-react";

import { Menu } from "~/components/ui/menu";

import type { ToolCard } from "./toolCards";

/**
 * The per-tool actions, in one trailing overflow menu.
 *
 * One menu for both layouts: the grid card puts it in its header, the table
 * in its trailing cell, and neither invents its own set. Per
 * dev/docs/best_practices/row-actions-overflow-menu.md — one vertical
 * three-dot trigger, destructive item tinted, no inline buttons.
 *
 * Spec: specs/ai-governance/dashboard/inventory-catalog.feature
 */
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
        <Button
          size="xs"
          variant="ghost"
          aria-label={`Actions for ${card.name}`}
        >
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
          {/* "Published", not "enabled": what the switch changes is whether
              the people in this organization can reach the tool from their
              own portal, and that is the word they see there. */}
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
