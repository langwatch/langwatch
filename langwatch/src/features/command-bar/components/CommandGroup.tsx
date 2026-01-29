import { Text, VStack } from "@chakra-ui/react";
import { CommandItem } from "./CommandItem";
import type { ListItem } from "../getIconInfo";

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
    <VStack align="stretch" gap={0}>
      <Text
        fontSize="12px"
        fontWeight="normal"
        color="fg.muted"
        px={4}
        paddingTop={3}
        paddingBottom={1.5}
      >
        {label}
      </Text>
      {items.map((item, i) => (
        <CommandItem
          key={
            item.type === "project"
              ? `project-${item.data.slug}`
              : item.type === "command"
                ? item.data.id
                : item.type === "search"
                  ? item.data.id
                  : item.data.id
          }
          item={item}
          index={startIndex + i}
          isSelected={startIndex + i === selectedIndex}
          onSelect={onSelect}
          onMouseEnter={onMouseEnter}
        />
      ))}
    </VStack>
  );
}
