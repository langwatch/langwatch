import { CommandBarGroup } from "@langwatch/design-system/app-shell";

import { getItemKey, type ListItem } from "../../model/command-icon-info.ts";
import { CommandItem } from "../elements/command-item.tsx";

interface CommandGroupProps {
  label: string;
  items: ListItem[];
  startIndex: number;
  selectedIndex: number;
  onSelect: (item: ListItem) => void;
  onMouseEnter: (index: number) => void;
}

/**
 * Renders a group of command items with a label header.
 */
export function CommandGroup({
  label,
  items,
  startIndex,
  selectedIndex,
  onSelect,
  onMouseEnter,
}: CommandGroupProps) {
  if (items.length === 0) return null;

  return (
    <CommandBarGroup label={label}>
      {items.map((item, i) => (
        <CommandItem
          key={getItemKey(item)}
          item={item}
          index={startIndex + i}
          isSelected={startIndex + i === selectedIndex}
          onSelect={onSelect}
          onMouseEnter={onMouseEnter}
        />
      ))}
    </CommandBarGroup>
  );
}
