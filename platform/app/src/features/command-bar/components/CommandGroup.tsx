import { Text, VStack } from "@chakra-ui/react";
import { getItemKey, type ListItem } from "../getIconInfo";
import { CommandItem } from "./CommandItem";

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
        px={{ base: 4, md: 5 }}
        paddingTop={3.5}
        paddingBottom={1.5}
      >
        {label}
      </Text>
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
    </VStack>
  );
}
