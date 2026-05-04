import { Badge, Box, HStack, Text } from "@chakra-ui/react";
import { memo, useCallback } from "react";
import { analyzeOrGroups } from "~/server/app-layer/traces/query-language/queries";
import { useFacetHoverStore } from "../../stores/facetHoverStore";
import { useFilterStore } from "../../stores/filterStore";
import { RowButton } from "./RowButton";
import type { FacetItem, FacetValueState } from "./types";
import { formatCount, paletteFromColor } from "./utils";

const TYPED_LABEL_REGEX = /^\[([^\]]+)\]\s*(.+)$/;

function parseTypedLabel(label: string): { typeTag?: string; text: string } {
  const match = TYPED_LABEL_REGEX.exec(label);
  if (!match) return { text: label };
  return { typeTag: match[1], text: match[2]! };
}

const MIN_VISIBLE_FILL_PCT = 4;

// Mirror of SidebarSection's hash → palette so OR-group rings here use
// the same colour as their section header. Six well-spaced pastel hues.
const OR_GROUP_PALETTE = [
  "purple",
  "teal",
  "pink",
  "yellow",
  "cyan",
  "green",
] as const;

function orGroupColor(id: string): (typeof OR_GROUP_PALETTE)[number] {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return OR_GROUP_PALETTE[
    Math.abs(h) % OR_GROUP_PALETTE.length
  ] as (typeof OR_GROUP_PALETTE)[number];
}

export const FacetRow = memo(function FacetRow({
  item,
  state,
  maxCount,
  onToggle,
  orGroupId,
  field,
}: {
  item: FacetItem;
  state: FacetValueState;
  maxCount: number;
  /**
   * `modifierKey` is `true` when the user held Shift or Ctrl/Cmd while
   * clicking. The store reads this as "combine with OR" instead of the
   * default AND, so users can build alternative-set queries without
   * dropping into the search bar to type the operator themselves.
   */
  onToggle: (value: string, options?: { modifierKey?: boolean }) => void;
  /** Set when this specific value is a member of an OR group — paints
   * the row with a coloured outline matching the section's OR pill. */
  orGroupId?: string;
  /** Field name (e.g. "status", "model") — used to broadcast hover so
   * the matching search-bar chip can highlight even when the row isn't
   * part of an OR group. */
  field?: string;
}) {
  const { typeTag, text } = parseTypedLabel(item.label);

  // Synthetic rows have no real count yet — render with zero fill so they
  // don't look like "0 matches" while we're still waiting on the real
  // descriptors. Once real data lands the row gets a count + bar.
  const fillPct =
    !item.synthetic && maxCount > 0
      ? Math.max(
          (item.count / maxCount) * 100,
          item.count > 0 ? MIN_VISIBLE_FILL_PCT : 0,
        )
      : 0;

  const isInclude = state === "include";
  const isExclude = state === "exclude";
  const isActive = isInclude || isExclude;

  const palette = isExclude ? "red" : paletteFromColor(item.dotColor);
  const orbOpacity = item.dimmed ? (isActive ? 0.85 : 0.55) : 1;

  const ariaChecked = isInclude ? true : isExclude ? "mixed" : false;
  const ariaLabel = `${item.label} — ${
    isInclude ? "included" : isExclude ? "excluded" : "click to include"
  }`;

  const subtleBg = `${palette}.subtle`;
  const solidBar = `${palette}.solid`;
  // OR group ring: when this row's value is a member of an OR group,
  // paint a coloured outline matching the section's OR pill so users
  // can match values to their group at a glance, even across distant
  // sections in the sidebar.
  const orPalette = orGroupId ? orGroupColor(orGroupId) : null;

  const setHoveredFacet = useFacetHoverStore((s) => s.setHoveredFacet);
  const setHoveredGroup = useFacetHoverStore((s) => s.setHoveredGroup);
  const clearHover = useFacetHoverStore((s) => s.clearHover);
  const handleMouseEnter = useCallback(() => {
    if (!field) return;
    // If this field is part of an OR group, broadcast the whole group
    // so the highlighter lights up every member (in the sidebar AND
    // the search bar). Otherwise fall back to the single facet so the
    // matching chip in the search bar still pulses.
    const ast = useFilterStore.getState().ast;
    const orAnalysis = analyzeOrGroups(ast);
    const groupId = orAnalysis.fieldToGroupId.get(field);
    const group = groupId
      ? orAnalysis.groups.find((g) => g.id === groupId)
      : null;
    if (group) {
      setHoveredGroup(group);
    } else {
      setHoveredFacet({ field, value: item.value });
    }
  }, [field, item.value, setHoveredFacet, setHoveredGroup]);
  const handleMouseLeave = useCallback(() => clearHover(), [clearHover]);

  return (
    <RowButton
      type="button"
      role="checkbox"
      aria-checked={ariaChecked}
      aria-label={ariaLabel}
      position="relative"
      width="full"
      paddingY={1}
      paddingLeft={1.5}
      paddingRight={0}
      cursor="pointer"
      textAlign="left"
      borderRadius="sm"
      overflow="hidden"
      background={isActive ? subtleBg : "transparent"}
      borderWidth={0}
      data-state={state}
      data-or-group={orGroupId}
      data-facet-field={field}
      data-facet-value={item.value}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={(e) =>
        onToggle(item.value, {
          modifierKey: e.shiftKey || e.ctrlKey || e.metaKey,
        })
      }
      transition="background 120ms ease, border-color 120ms ease"
      _hover={{
        background: isActive ? subtleBg : "bg.muted",
        "& [data-facet-orb]": {
          opacity: 1,
          transform: "scale(1.15)",
        },
      }}
      _focusVisible={{
        outline: "2px solid",
        outlineColor: "blue.focusRing",
        outlineOffset: "-2px",
      }}
    >
      <Box
        position="absolute"
        bottom={0}
        left={0}
        width={`${fillPct}%`}
        height="2px"
        bg={solidBar}
        opacity={item.dimmed ? 0.35 : 0.55}
        pointerEvents="none"
        transition="width 120ms ease"
      />
      {isActive && (
        <Box
          position="absolute"
          top={0}
          right={0}
          bottom={0}
          width="2px"
          bg={solidBar}
          pointerEvents="none"
        />
      )}
      <HStack gap={1.5} position="relative" minWidth={0} zIndex={1}>
        <Box
          data-facet-orb
          width="8px"
          height="8px"
          borderRadius="full"
          bg={solidBar}
          opacity={orbOpacity}
          flexShrink={0}
          transition="opacity 120ms ease, transform 120ms ease"
        />
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
          fontWeight={isActive ? "600" : "500"}
          truncate
          flex={1}
          minWidth={0}
          color={isActive ? "fg" : "fg.muted"}
          textDecoration={isExclude ? "line-through" : undefined}
        >
          {text}
        </Text>
        {!item.synthetic && (
          <Text
            textStyle="xs"
            color="fg.subtle"
            fontFamily="mono"
            mr={2}
            fontWeight={isActive ? "600" : "400"}
            flexShrink={0}
          >
            {formatCount(item.count)}
          </Text>
        )}
      </HStack>
    </RowButton>
  );
});
