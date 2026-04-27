// eslint-disable-next-line no-restricted-imports
import {
  Badge,
  Box,
  Button,
  chakra,
  HStack,
  Input,
  type SystemStyleObject,
  Text,
  VStack,
} from "@chakra-ui/react";

const RowButton = chakra("button");
import type React from "react";
import { memo, useCallback, useMemo, useState } from "react";
import { useFacetLensStore } from "../../stores/facetLensStore";
import { SidebarSection } from "./SidebarSection";

export type FacetValueState = "neutral" | "include" | "exclude";

export interface FacetItem {
  value: string;
  label: string;
  count: number;
  dotColor?: NonNullable<SystemStyleObject["color"]>;
}

interface FacetSectionProps {
  title: string;
  field: string;
  items: FacetItem[];
  getValueState: (value: string) => FacetValueState;
  onToggle: (field: string, value: string) => void;
  /** Drag handle props from a sortable parent. */
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>;
  /** When set, renders a "(none)" row pinned at the bottom that toggles a `none:`/`has:` filter. */
  noneRow?: { active: boolean; onToggle: () => void };
}

const MAX_VISIBLE = 10;
const MAX_EXPANDED = 30;
/** Sections with at most this many values get auto-expanded. */
const AUTO_EXPAND_THRESHOLD = 5;

export const FacetSection: React.FC<FacetSectionProps> = ({
  title,
  field,
  items,
  getValueState,
  onToggle,
  dragHandleProps,
  noneRow,
}) => {
  const lensOverride = useFacetLensStore((s) => s.lens.sectionOpen[field]);
  const setSectionOpen = useFacetLensStore((s) => s.setSectionOpen);
  const [showMore, setShowMore] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const handleToggle = useCallback(
    (value: string) => onToggle(field, value),
    [onToggle, field],
  );

  const activeCount = useMemo(() => {
    const itemsActive = items.filter(
      (i) => getValueState(i.value) !== "neutral",
    ).length;
    return itemsActive + (noneRow?.active ? 1 : 0);
  }, [items, getValueState, noneRow?.active]);

  const sorted = useMemo(
    () => [...items].sort((a, b) => b.count - a.count),
    [items],
  );

  const filtered = useMemo(() => {
    if (!searchQuery) return sorted;
    const q = searchQuery.toLowerCase();
    return sorted.filter((i) => i.label.toLowerCase().includes(q));
  }, [sorted, searchQuery]);

  const isHighCardinality = items.length >= MAX_VISIBLE;
  const visibleItems = useMemo(() => {
    if (searchQuery) return filtered;
    if (!isHighCardinality) return filtered;
    if (showMore) return filtered.slice(0, MAX_EXPANDED);
    return filtered.slice(0, MAX_VISIBLE);
  }, [filtered, isHighCardinality, showMore, searchQuery]);

  const maxCount = useMemo(
    () => visibleItems.reduce((m, i) => (i.count > m ? i.count : m), 0),
    [visibleItems],
  );

  const remainingCount = isHighCardinality
    ? Math.min(filtered.length - MAX_VISIBLE, MAX_EXPANDED - MAX_VISIBLE)
    : 0;
  const beyondExpanded =
    isHighCardinality && filtered.length > MAX_EXPANDED
      ? filtered.length - MAX_EXPANDED
      : 0;

  const smartDefaultOpen =
    items.length <= AUTO_EXPAND_THRESHOLD || activeCount > 0;
  const effectiveOpen = lensOverride ?? smartDefaultOpen;

  return (
    <SidebarSection
      title={title}
      open={effectiveOpen}
      onOpenChange={(next) => setSectionOpen(field, next)}
      dragHandleProps={dragHandleProps}
      valueCount={items.length}
      hasActive={activeCount > 0}
      activeIndicator={
        activeCount > 0 ? (
          <Badge
            variant="solid"
            size="xs"
            colorPalette="blue"
            borderRadius="full"
          >
            {activeCount}
          </Badge>
        ) : undefined
      }
    >
      <VStack gap={0.5} align="stretch">
        {visibleItems.map((item) => {
          const state = getValueState(item.value);
          return (
            <FacetRow
              key={item.value}
              item={item}
              state={state}
              maxCount={maxCount}
              onToggle={handleToggle}
            />
          );
        })}

        {noneRow && !searchQuery && (
          <NoneFacetRow
            active={noneRow.active}
            onToggle={noneRow.onToggle}
          />
        )}

        {isHighCardinality && !searchQuery && (
          <>
            {!showMore && remainingCount > 0 && (
              <Button
                variant="plain"
                size="xs"
                justifyContent="flex-start"
                width="fit-content"
                color="blue.fg"
                paddingX={1}
                paddingY={1}
                height="auto"
                _hover={{ textDecoration: "underline" }}
                onClick={() => setShowMore(true)}
              >
                Show {remainingCount} more
              </Button>
            )}
            {showMore && (
              <>
                {beyondExpanded > 0 && (
                  <Text
                    textStyle="xs"
                    color="fg.subtle"
                    paddingX={1}
                    paddingY={0.5}
                  >
                    And {beyondExpanded} more — use search to filter
                  </Text>
                )}
                <Button
                  variant="plain"
                  size="xs"
                  justifyContent="flex-start"
                  width="fit-content"
                  color="blue.fg"
                  paddingX={1}
                  paddingY={1}
                  height="auto"
                  _hover={{ textDecoration: "underline" }}
                  onClick={() => setShowMore(false)}
                >
                  Show less
                </Button>
              </>
            )}
          </>
        )}

        {isHighCardinality && (
          <Input
            size="xs"
            placeholder="Filter..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            marginTop={1}
            textStyle="xs"
          />
        )}
      </VStack>
    </SidebarSection>
  );
};

const TYPED_LABEL_REGEX = /^\[([^\]]+)\]\s*(.+)$/;

/** Extract a Chakra color palette name (e.g. "blue") from a token like "blue.solid". */
function paletteFromColor(color: FacetItem["dotColor"]): string {
  if (typeof color !== "string") return "gray";
  const idx = color.indexOf(".");
  return idx === -1 ? color : color.slice(0, idx);
}

const FacetRow = memo(function FacetRow({
  item,
  state,
  maxCount,
  onToggle,
}: {
  item: FacetItem;
  state: FacetValueState;
  maxCount: number;
  onToggle: (value: string) => void;
}) {
  const typedMatch = TYPED_LABEL_REGEX.exec(item.label);
  const typeTag = typedMatch?.[1];
  const labelText = typedMatch?.[2] ?? item.label;

  const fillPct =
    maxCount > 0 ? Math.max((item.count / maxCount) * 100, item.count > 0 ? 4 : 0) : 0;

  const isInclude = state === "include";
  const isExclude = state === "exclude";

  // Use semantic tokens (subtle/muted) so bars adapt to light + dark mode.
  // Solid + opacity looked muddy.
  const palette = paletteFromColor(item.dotColor);
  const barBg = isExclude
    ? "red.muted"
    : isInclude
      ? `${palette}.muted`
      : `${palette}.subtle`;

  const ariaState = isInclude ? "true" : isExclude ? "mixed" : "false";

  return (
    <RowButton
      type="button"
      role="checkbox"
      aria-checked={ariaState}
      aria-label={`${item.label} — ${
        isInclude ? "included" : isExclude ? "excluded" : "click to include"
      }`}
      position="relative"
      width="full"
      paddingY={1}
      paddingX={1.5}
      cursor="pointer"
      textAlign="left"
      borderRadius="sm"
      overflow="hidden"
      background="transparent"
      border="none"
      data-state={state}
      onClick={() => onToggle(item.value)}
      _hover={{
        "& [data-facet-label]": {
          color: "var(--chakra-colors-fg)",
          fontWeight: 500,
        },
        "& [data-facet-bar]": {
          background: isExclude
            ? "var(--chakra-colors-red-emphasized)"
            : `var(--chakra-colors-${palette}-emphasized)`,
        },
      }}
      _focusVisible={{
        outline: "2px solid",
        outlineColor: "blue.focusRing",
        outlineOffset: "-2px",
      }}
    >
      <Box
        data-facet-bar
        position="absolute"
        top={0}
        bottom={0}
        left={0}
        width={`${fillPct}%`}
        bg={barBg}
        pointerEvents="none"
        transition="width 120ms ease, background 120ms ease"
      />
      <HStack gap={1.5} position="relative" minWidth={0} zIndex={1}>
        {typeTag && (
          <Badge
            size="xs"
            variant="outline"
            color="fg.subtle"
            paddingX={1}
            flexShrink={0}
            textTransform="lowercase"
            fontFamily="mono"
            fontWeight="500"
          >
            {typeTag}
          </Badge>
        )}
        <Text
          textStyle="xs"
          fontWeight={state === "neutral" ? "400" : "500"}
          truncate
          flex={1}
          minWidth={0}
          data-facet-label
          color={state === "neutral" ? "fg.muted" : "fg"}
          textDecoration={isExclude ? "line-through" : undefined}
        >
          {labelText}
        </Text>
        <Text
          textStyle="xs"
          color="fg.subtle"
          fontFamily="mono"
          fontWeight="400"
          flexShrink={0}
        >
          {formatFacetCount(item.count)}
        </Text>
      </HStack>
    </RowButton>
  );
});

function formatFacetCount(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M`;
  }
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1)}K`;
  }
  return String(count);
}

const NoneFacetRow = memo(function NoneFacetRow({
  active,
  onToggle,
}: {
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <RowButton
      type="button"
      role="checkbox"
      aria-checked={active}
      aria-label={
        active ? "Filtering for missing values" : "Show missing values only"
      }
      position="relative"
      width="full"
      paddingY={1}
      paddingX={1.5}
      cursor="pointer"
      textAlign="left"
      borderRadius="sm"
      overflow="hidden"
      background="transparent"
      border="none"
      data-state={active ? "include" : "neutral"}
      onClick={onToggle}
      _hover={{
        "& [data-facet-label]": {
          color: "var(--chakra-colors-fg)",
        },
        "& [data-facet-bar]": {
          background: "var(--chakra-colors-gray-emphasized)",
        },
      }}
      _focusVisible={{
        outline: "2px solid",
        outlineColor: "blue.focusRing",
        outlineOffset: "-2px",
      }}
    >
      <Box
        data-facet-bar
        position="absolute"
        top={0}
        bottom={0}
        left={0}
        width="100%"
        bg={active ? "gray.muted" : "transparent"}
        pointerEvents="none"
        transition="background 120ms ease"
      />
      <HStack gap={1.5} position="relative" minWidth={0} zIndex={1}>
        <Text
          textStyle="xs"
          fontStyle="italic"
          fontWeight={active ? "500" : "400"}
          truncate
          flex={1}
          minWidth={0}
          data-facet-label
          color={active ? "fg" : "fg.subtle"}
        >
          (none)
        </Text>
      </HStack>
    </RowButton>
  );
});
