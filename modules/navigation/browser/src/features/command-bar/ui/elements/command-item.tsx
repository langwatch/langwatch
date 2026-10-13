import { formatTimeAgoCompact } from "@langwatch/browser-host/format-time-ago";
import { CommandBarItem } from "@langwatch/design-system/app-shell";

import { getIconInfo, type ListItem } from "../../model/command-icon-info.ts";

interface CommandItemProps {
  item: ListItem;
  index: number;
  isSelected: boolean;
  onSelect: (item: ListItem) => void;
  onMouseEnter: (index: number) => void;
}

function labelsOf(item: ListItem): { label: string; description?: string } {
  if (item.type === "project") return { label: item.data.name, description: item.data.orgTeam };
  return { label: item.data.label, description: item.data.description };
}

function metaOf(item: ListItem): string | undefined {
  if (item.type === "recent") return formatTimeAgoCompact(item.data.accessedAt);
  if (item.type === "command") return item.data.productLabel;
  return undefined;
}

/** One command bar row for a command, search result, recent item or project. */
export function CommandItem({ item, index, isSelected, onSelect, onMouseEnter }: CommandItemProps) {
  const { Icon, color } = getIconInfo(item);
  return (
    <CommandBarItem
      icon={Icon}
      iconColor={color}
      {...labelsOf(item)}
      meta={metaOf(item)}
      index={index}
      isSelected={isSelected}
      onSelect={() => onSelect(item)}
      onMouseEnter={() => onMouseEnter(index)}
    />
  );
}
