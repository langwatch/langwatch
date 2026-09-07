import { Box, chakra, HStack, Icon, Text } from "@chakra-ui/react";
import { Ban, Minus } from "lucide-react";
import { memo, useCallback } from "react";
import { useFacetHoverStore } from "../../stores/facetHoverStore";
import { RowButton } from "./RowButton";
import type { FacetItem, FacetValueState } from "./types";
import { formatCount, paletteFromColor } from "./utils";

const MIN_VISIBLE_FILL_PCT = 4;

export const FacetRow = memo(function FacetRow({
  item,
  state,
  maxCount,
  onToggle,
  onExclude,
  field,
}: {
  item: FacetItem;
  state: FacetValueState;
  maxCount: number;
  /** Row-body click: include a neutral value, or clear an active one. */
  onToggle: (value: string) => void;
  /** Trailing `−` click: exclude (`NOT field:value`), or clear if already
   * excluded. Lets users exclude in one deliberate click instead of
   * cycling include → exclude. */
  onExclude: (value: string) => void;
  /** Field name (e.g. "status", "model") — used to broadcast hover so
   * the matching search-bar chip can highlight. */
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
  const orbOpacity = item.dimmed ? (isActive ? 0.9 : 0.6) : 1;

  const ariaChecked = isInclude ? true : isExclude ? "mixed" : false;
  const ariaLabel = `${item.label} — ${
    isInclude ? "included" : isExclude ? "excluded" : "click to include"
  }`;

  const subtleBg = `${palette}.subtle`;
  const solidBar = `${palette}.solid`;

  const setHoveredFacet = useFacetHoverStore((s) => s.setHoveredFacet);
  const clearHover = useFacetHoverStore((s) => s.clearHover);
  // Hovering a row highlights the matching search-bar chip (and vice
  // versa) for this single (field, value) pair. Bound to the wrapper so
  // hovering the trailing `−` keeps the highlight lit too.
  const handleMouseEnter = useCallback(() => {
    if (!field) return;
    // Pass the facet's own palette so the cross-highlight paints in its
    // identity colour, not a blanket blue. Use the dot's palette (not the
    // exclude-red) so the highlight matches the value's dot.
    setHoveredFacet({
      field,
      value: item.value,
      palette: paletteFromColor(item.dotColor),
    });
  }, [field, item.value, item.dotColor, setHoveredFacet]);
  const handleMouseLeave = useCallback(() => clearHover(), [clearHover]);

  return (
    // `role="group"` + `data-group` lets the trailing exclude reveal itself on
    // hover of the whole row. The exclude is its own flex element AFTER the
    // count (a separate-but-joined slot), not an overlay on the count.
    <Box
      role="group"
      data-group
      position="relative"
      width="full"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      // Brighten the exclude on row hover. A descendant selector on the
      // parent's `_hover` (the pattern the orb uses) — `_groupHover` here would
      // need `className="group"`, which this row doesn't set, so it never fired.
      // Its slot is reserved (fixed width) so hovering never shifts the row.
      _hover={{
        "& [data-facet-exclude]": { opacity: 0.65 },
      }}
    >
      <HStack gap={0.5} align="center" width="full">
        <RowButton
          type="button"
          role="checkbox"
          aria-checked={ariaChecked}
          aria-label={ariaLabel}
          position="relative"
          flex={1}
          minWidth={0}
          paddingY={1}
          // Internal x-padding so the dot + label + count breathe inside the
          // row's hover / selected background instead of jamming its edges.
          paddingLeft={1.5}
          paddingRight={1.5}
          cursor="pointer"
          textAlign="left"
          borderRadius="md"
          overflow="hidden"
          background={isActive ? subtleBg : "transparent"}
          borderWidth={0}
          data-state={state}
          data-facet-field={field}
          data-facet-value={item.value}
          onClick={() => onToggle(item.value)}
          transition="background 120ms ease"
          _hover={{
            background: isActive ? subtleBg : "bg.muted",
            "& [data-facet-orb]": { opacity: 1 },
          }}
          _focusVisible={{
            outline: "2px solid",
            outlineColor: "blue.focusRing",
            outlineOffset: "-2px",
          }}
        >
          {/* Count bar — a thin underline whose width encodes relative volume.
              Sits flush at the bottom so it never competes with the label. */}
          <Box
            position="absolute"
            bottom={0}
            left={0}
            width={`${fillPct}%`}
            height="2px"
            bg={solidBar}
            opacity={item.dimmed ? 0.3 : 0.5}
            pointerEvents="none"
            transition="width 120ms ease"
          />
          <HStack gap={1.5} position="relative" minWidth={0} zIndex={1}>
            <Box
              data-facet-orb
              width="7px"
              height="7px"
              borderRadius="full"
              bg={solidBar}
              opacity={orbOpacity}
              flexShrink={0}
              transition="opacity 120ms ease"
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
                data-facet-count
                textStyle="xs"
                color="fg.subtle"
                fontWeight={isActive ? "600" : "400"}
                flexShrink={0}
                fontVariantNumeric="tabular-nums"
              >
                {formatCount(item.count)}
              </Text>
            )}
          </HStack>
        </RowButton>
        {/* Exclude affordance — its own element at the END of the line, after
            the count (a separate but joined slot, never overlaying the count).
            Its width is always reserved so the layout is stable; the glyph is
            hidden at rest, fades in on row hover, and stays solid (as a `Ban`
            ∅, in red) while the value is excluded. Sibling of RowButton, not a
            child — you can't nest a <button> inside the row's <button>. */}
        <chakra.button
          type="button"
          aria-label={
            isExclude ? `Stop excluding ${item.label}` : `Exclude ${item.label}`
          }
          title={isExclude ? "Stop excluding" : "Exclude (NOT)"}
          aria-pressed={isExclude}
          data-facet-exclude
          flexShrink={0}
          // Reserved fixed slot at the end of the line, after the count — a
          // distinct, always-present element (faint at rest, brighter on row
          // hover, solid red `Ban` while excluded). Reserved so it never shifts
          // the row; the label flex-grows so the count + this sit at the right.
          width="20px"
          height="22px"
          display="flex"
          alignItems="center"
          justifyContent="center"
          borderRadius="sm"
          background="transparent"
          border="none"
          cursor="pointer"
          color={isExclude ? "red.fg" : "fg.subtle"}
          opacity={isExclude ? 1 : 0.3}
          transition="opacity 120ms ease, color 120ms ease, background 120ms ease"
          _hover={{ color: "red.fg", opacity: 1, background: "red.subtle" }}
          _focusVisible={{
            opacity: 1,
            color: "red.fg",
            outline: "2px solid",
            outlineColor: "red.focusRing",
            outlineOffset: "1px",
          }}
          onClick={() => onExclude(item.value)}
        >
          <Icon boxSize="13px">{isExclude ? <Ban /> : <Minus />}</Icon>
        </chakra.button>
      </HStack>
    </Box>
  );
});
