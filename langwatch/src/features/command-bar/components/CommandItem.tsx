import { Box, HStack, Text } from "@chakra-ui/react";
import { CornerDownLeft } from "lucide-react";
import { formatTimeAgo } from "../formatTimeAgo";
import { getIconInfo, type ListItem } from "../getIconInfo";

interface CommandItemProps {
  item: ListItem;
  index: number;
  isSelected: boolean;
  onSelect: (item: ListItem) => void;
  onMouseEnter: (index: number) => void;
}

/**
 * Renders a single command item row in the command bar.
 */
export function CommandItem({
  item,
  index,
  isSelected,
  onSelect,
  onMouseEnter,
}: CommandItemProps) {
  const { Icon, color } = getIconInfo(item);

  let label = "";
  let description: string | undefined;

  if (item.type === "command") {
    label = item.data.label;
    description = item.data.description;
  } else if (item.type === "search") {
    label = item.data.label;
    description = item.data.description;
  } else if (item.type === "recent") {
    label = item.data.label;
    description = item.data.description;
  } else if (item.type === "project") {
    label = item.data.name;
    description = item.data.orgTeam;
  }

  const key =
    item.type === "project"
      ? `project-${item.data.slug}`
      : item.type === "command"
        ? item.data.id
        : item.type === "search"
          ? item.data.id
          : item.data.id;

  return (
    <HStack
      key={key}
      px={4}
      py={1.5}
      cursor="pointer"
      borderRadius="md"
      marginX={2}
      bg={isSelected ? "bg.emphasized" : "transparent"}
      _hover={{ bg: "bg.muted" }}
      onClick={() => onSelect(item)}
      onMouseEnter={() => onMouseEnter(index)}
      gap={3}
    >
      <Box color={color} flexShrink={0}>
        <Icon size={18} />
      </Box>
      <HStack flex={1} gap={2} overflow="hidden">
        <Text
          fontSize="14px"
          fontWeight="medium"
          color="fg.default"
          whiteSpace="nowrap"
          overflow="hidden"
          textOverflow="ellipsis"
        >
          {label}
        </Text>
        {description && (
          <Text
            fontSize="12px"
            color="fg.subtle"
            whiteSpace="nowrap"
            overflow="hidden"
            textOverflow="ellipsis"
          >
            {description}
          </Text>
        )}
      </HStack>
      {/* Time ago for recent items */}
      {item.type === "recent" && (
        <Text fontSize="11px" color="fg.muted" flexShrink={0}>
          {formatTimeAgo(item.data.accessedAt)}
        </Text>
      )}
      {isSelected && (
        <Box color="fg.muted" flexShrink={0}>
          <CornerDownLeft size={14} />
        </Box>
      )}
    </HStack>
  );
}
