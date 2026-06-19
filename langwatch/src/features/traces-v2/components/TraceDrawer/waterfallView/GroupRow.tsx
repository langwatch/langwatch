import { Flex, HStack, Icon, Text } from "@chakra-ui/react";
import { memo, useCallback } from "react";
import { LuLayers, LuList } from "react-icons/lu";
import { Tooltip } from "~/components/ui/tooltip";
import { formatDuration, SPAN_TYPE_COLORS } from "../../../utils/formatters";
import {
  GROUP_ROW_HEIGHT,
  getSpanPalette,
  INDENT_PX,
  type SiblingGroup,
} from "./types";

/**
 * Folded "N duplicated siblings" row. Deliberately styled apart from
 * TreeRow's plain parent/child collapse: a stacked-layers leading icon
 * (instead of chevron + type icon), a "×N repeated" pill, and a DASHED
 * left border (TreeRow's selection border is solid) — so the two
 * collapse kinds can't be mistaken for each other.
 */
export const GroupRow = memo(function GroupRow({
  group,
  groupKey,
  isExpanded,
  onToggle,
  onSwitchToSpanList,
}: {
  group: SiblingGroup;
  /** Stable identity for this fold — `parentSpanId::name`. */
  groupKey: string;
  isExpanded: boolean;
  onToggle: (groupKey: string) => void;
  onSwitchToSpanList?: (nameFilter: string, typeFilter: string) => void;
}) {
  const handleToggle = useCallback(
    () => onToggle(groupKey),
    [onToggle, groupKey],
  );
  const color = (SPAN_TYPE_COLORS[group.type] as string) ?? "gray.solid";
  const palette = getSpanPalette(group.type);

  return (
    <Tooltip
      content={`${group.count} identical sibling spans folded — click to ${
        isExpanded ? "collapse" : "expand"
      }`}
      positioning={{ placement: "right" }}
    >
      <HStack
        height={`${GROUP_ROW_HEIGHT}px`}
        gap={0}
        paddingLeft={`${group.depth * INDENT_PX + 4}px`}
        paddingRight={2}
        bg="bg.subtle/40"
        _hover={{ bg: "bg.muted" }}
        cursor="pointer"
        onClick={handleToggle}
        flexShrink={0}
        borderLeftWidth="2px"
        borderLeftStyle="dashed"
        borderLeftColor={color}
      >
        {/* Stacked-duplicates icon — replaces the chevron + type-icon
            pair so the row reads as "folded duplicates", not as a
            collapsible parent. `colorPalette` scope for the same
            dark-mode-contrast rationale as TreeRow's type chip. */}
        <Flex
          width="18px"
          height="18px"
          align="center"
          justify="center"
          flexShrink={0}
          marginRight={1.5}
          borderRadius="sm"
          colorPalette={palette}
          bg="colorPalette.subtle"
          color="colorPalette.fg"
        >
          <Icon as={LuLayers} boxSize={3} />
        </Flex>

        {/* Group info */}
        <Flex direction="column" flex={1} minWidth={0} gap={0} justify="center">
          <HStack gap={1.5} minWidth={0}>
            <Text textStyle="xs" color="fg" truncate>
              {group.name}
            </Text>
            <Text
              textStyle="2xs"
              colorPalette={palette}
              color="colorPalette.fg"
              bg="colorPalette.subtle"
              fontWeight="semibold"
              borderRadius="full"
              paddingX={1.5}
              lineHeight={1.5}
              whiteSpace="nowrap"
              flexShrink={0}
            >
              ×{group.count} repeated
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
          <Tooltip
            content="View in Span List"
            positioning={{ placement: "top" }}
          >
            <Flex
              as="button"
              aria-label="View in Span List"
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
    </Tooltip>
  );
});
