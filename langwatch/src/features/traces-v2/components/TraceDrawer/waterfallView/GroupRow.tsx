import { Flex, HStack, Icon, Text } from "@chakra-ui/react";
import { LuChevronDown, LuChevronRight, LuList } from "react-icons/lu";
import { Tooltip } from "~/components/ui/tooltip";
import { formatDuration, SPAN_TYPE_COLORS } from "../../../utils/formatters";
import {
  GROUP_ROW_HEIGHT,
  INDENT_PX,
  type SiblingGroup,
  SPAN_TYPE_ICONS,
} from "./types";

export function GroupRow({
  group,
  isExpanded,
  onToggle,
  onSwitchToSpanList,
}: {
  group: SiblingGroup;
  isExpanded: boolean;
  onToggle: () => void;
  onSwitchToSpanList?: (nameFilter: string, typeFilter: string) => void;
}) {
  const color = (SPAN_TYPE_COLORS[group.type] as string) ?? "gray.solid";
  const icon = SPAN_TYPE_ICONS[group.type] ?? "○";

  return (
    <HStack
      height={`${GROUP_ROW_HEIGHT}px`}
      gap={0}
      paddingLeft={`${group.depth * INDENT_PX + 4}px`}
      paddingRight={2}
      bg="bg.subtle/40"
      _hover={{ bg: "bg.muted" }}
      cursor="pointer"
      onClick={onToggle}
      userSelect="none"
      flexShrink={0}
      borderLeftWidth="2px"
      borderLeftColor={color}
    >
      {/* Chevron */}
      <Flex
        width="16px"
        height="16px"
        align="center"
        justify="center"
        flexShrink={0}
      >
        <Icon
          as={isExpanded ? LuChevronDown : LuChevronRight}
          boxSize={3}
          color="fg.muted"
        />
      </Flex>

      {/* Type icon */}
      <Flex
        width="18px"
        height="18px"
        align="center"
        justify="center"
        flexShrink={0}
        marginRight={1}
      >
        <Text textStyle="xs" color={color} lineHeight={1}>
          {icon}
        </Text>
      </Flex>

      {/* Group info */}
      <Flex direction="column" flex={1} minWidth={0} gap={0} justify="center">
        <HStack gap={1.5} minWidth={0}>
          <Text textStyle="xs" fontFamily="mono" color="fg" truncate>
            {group.name}
          </Text>
          <Text
            textStyle="xs"
            color={color}
            fontWeight="semibold"
            flexShrink={0}
          >
            ×{group.count}
          </Text>
        </HStack>
        <HStack gap={1.5}>
          <Text textStyle="xs" color="fg.subtle" whiteSpace="nowrap">
            avg {formatDuration(group.avgDuration)}
          </Text>
          <Text textStyle="xs" color="fg.subtle" whiteSpace="nowrap">
            {formatDuration(group.minDuration)}–
            {formatDuration(group.maxDuration)}
          </Text>
          {group.errorCount > 0 && (
            <Text textStyle="xs" color="red.fg" whiteSpace="nowrap">
              {group.errorCount} error{group.errorCount > 1 ? "s" : ""}
            </Text>
          )}
        </HStack>
      </Flex>

      {/* View in Span List link */}
      {onSwitchToSpanList && (
        <Tooltip content="View in Span List" positioning={{ placement: "top" }}>
          <Flex
            as="button"
            align="center"
            justify="center"
            width="20px"
            height="20px"
            borderRadius="sm"
            color="fg.subtle"
            _hover={{ color: "blue.fg", bg: "blue.subtle" }}
            onClick={(e) => {
              e.stopPropagation();
              onSwitchToSpanList(group.name, group.type);
            }}
            flexShrink={0}
          >
            <Icon as={LuList} boxSize={3} />
          </Flex>
        </Tooltip>
      )}
    </HStack>
  );
}
