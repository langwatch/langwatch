import { Box, HStack, Text } from "@chakra-ui/react";
import { memo, useCallback } from "react";
import { analyzeOrGroups } from "~/server/app-layer/traces/query-language/queries";
import { useFacetHoverStore } from "../../stores/facetHoverStore";
import { useFilterStore } from "../../stores/filterStore";
import { orGroupColor } from "./orGroupPalette";
import { RowButton } from "./RowButton";
import type { FacetItem, FacetValueState } from "./types";
import { formatCount, paletteFromColor } from "./utils";

const MIN_VISIBLE_FILL_PCT = 4;

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
  // Hovering a row that's actually a member of an OR group lights up
  // every other member too. Just being in a *field* that participates
  // in some OR group isn't enough — `origin:simulation` hovered
  // shouldn't drag `origin:evaluation` and `origin:application`
  // along just because they happen to share the field. So look up
  // membership at the (field, value) level, not the field level.
  const handleMouseEnter = useCallback(() => {
    if (!field) return;
    const ast = useFilterStore.getState().ast;
    const orAnalysis = analyzeOrGroups(ast);
    const groupId = orAnalysis.memberToGroupId.get(`${field}|${item.value}`);
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
      outline={orPalette ? "1px solid" : undefined}
      outlineColor={orPalette ? `${orPalette}.muted` : undefined}
      outlineOffset="-1px"
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
        <Text
          textStyle="xs"
          fontWeight={isActive ? "600" : "500"}
          truncate
          flex={1}
          minWidth={0}
          color={isActive ? "fg" : "fg.muted"}
          textDecoration={isExclude ? "line-through" : undefined}
        >
          {item.label}
        </Text>
        {!item.synthetic && (
          <Text
            textStyle="xs"
            color="fg.subtle"
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
