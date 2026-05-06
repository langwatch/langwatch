import { Box } from "@chakra-ui/react";
import type React from "react";
import { useEffect, useLayoutEffect, useState } from "react";
import type { OrGroup } from "~/server/app-layer/traces/query-language/queries";
import { useFacetHoverStore } from "../../stores/facetHoverStore";

const LANE_WIDTH = 14;
const LINE_THICKNESS = 2;
const HIT_AREA_WIDTH = 10;

/**
 * Six well-spaced pastel hues — must match the palette in
 * `SidebarSection` so a group's pill and connector line share a colour.
 */
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

export const ConnectorLaneWidth = LANE_WIDTH;

interface OrConnectorOverlayProps {
  /** OR groups present in the current AST. Each gets its own lane. */
  groups: readonly OrGroup[];
  /**
   * Element to query for `[data-or-group="<id>"]` row decorations and
   * to anchor the overlay's bounding-box recomputation. The overlay
   * subscribes to this container's ResizeObserver so lines re-flow on
   * collapse/expand of facet sections.
   */
  containerRef: React.RefObject<HTMLElement | null>;
}

interface LineGeometry {
  groupId: string;
  palette: (typeof OR_GROUP_PALETTE)[number];
  laneIndex: number;
  topY: number;
  bottomY: number;
}

/**
 * Vertical connector lines linking the rows of each cross-facet OR
 * group. Lines live in their own per-group lane on the right gutter
 * of the sidebar.
 *
 * Hover the line, a sidebar row, or a search-bar chip → all three
 * surfaces light up via a single style-block driven by
 * `facetHoverStore`. That gives bidirectional cross-highlighting:
 * hover a chip and the matching row glows; hover a row in an OR
 * group and every other group member (chips and rows) lights up too.
 */
export const OrConnectorOverlay: React.FC<OrConnectorOverlayProps> = ({
  groups,
  containerRef,
}) => {
  const [lines, setLines] = useState<LineGeometry[]>([]);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(
    null,
  );
  // Local: which line the cursor is currently over. Used only for the
  // tooltip + the line's own thicken-on-hover affordance — does NOT
  // touch `facetHoverStore`, so member chips/rows stay quiet when
  // someone runs the cursor over the connector itself. The store gets
  // bumped only by direct chip/row hovers.
  const [hoveredLineId, setHoveredLineId] = useState<string | null>(null);

  const hoveredGroup = useFacetHoverStore((s) => s.hoveredGroup);
  const hoveredFacet = useFacetHoverStore((s) => s.hoveredFacet);

  // Stable lane assignment: sort groups by id so the lane index for a
  // given group doesn't shuffle between renders.
  const sortedGroups = [...groups].sort((a, b) => a.id.localeCompare(b.id));

  const recompute = (): void => {
    const container = containerRef.current;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    const next: LineGeometry[] = [];
    sortedGroups.forEach((group, laneIndex) => {
      const rows = Array.from(
        container.querySelectorAll(`[data-or-group="${group.id}"]`),
      ) as HTMLElement[];
      if (rows.length === 0) return;
      const palette = orGroupColor(group.id);
      const centers = rows.map((row) => {
        const r = row.getBoundingClientRect();
        return r.top + r.height / 2 - containerRect.top;
      });
      next.push({
        groupId: group.id,
        palette,
        laneIndex,
        topY: Math.min(...centers),
        bottomY: Math.max(...centers),
      });
    });
    setLines(next);
  };

  useLayoutEffect(() => {
    recompute();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, containerRef]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => recompute());
    observer.observe(container);
    container.addEventListener("scroll", recompute, true);
    return () => {
      observer.disconnect();
      container.removeEventListener("scroll", recompute, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef, groups]);

  if (sortedGroups.length === 0 && !hoveredFacet && !hoveredGroup) return null;

  return (
    <>
      {/* Style block lives at the document level via the same overlay so
          highlights apply to both sidebar rows AND search-bar chips
          regardless of where they're mounted. */}
      <HoverHighlightStyle
        group={hoveredGroup ?? null}
        facet={hoveredGroup ? null : hoveredFacet}
      />

      {sortedGroups.length > 0 && (
        <Box
          position="absolute"
          top={0}
          right={0}
          bottom={0}
          width={`${sortedGroups.length * LANE_WIDTH}px`}
          pointerEvents="none"
          zIndex={2}
        >
          {lines.map((line) => {
            const cx = line.laneIndex * LANE_WIDTH + LANE_WIDTH / 2;
            const lineColor = `var(--chakra-colors-${line.palette}-solid)`;
            const isHovered = hoveredLineId === line.groupId;
            const heightPx = Math.max(line.bottomY - line.topY, 1);
            return (
              <Box key={line.groupId} position="absolute" inset={0}>
                {/* Hit area — invisible but wider so the user doesn't
                    have to mouse onto a 2px line. */}
                <Box
                  position="absolute"
                  left={`${cx - HIT_AREA_WIDTH / 2}px`}
                  top={`${line.topY - 4}px`}
                  width={`${HIT_AREA_WIDTH}px`}
                  height={`${heightPx + 8}px`}
                  cursor="help"
                  pointerEvents="auto"
                  onMouseEnter={(e) => {
                    setHoveredLineId(line.groupId);
                    setTooltipPos({ x: e.clientX, y: e.clientY });
                  }}
                  onMouseMove={(e) =>
                    setTooltipPos({ x: e.clientX, y: e.clientY })
                  }
                  onMouseLeave={() => {
                    setHoveredLineId(null);
                    setTooltipPos(null);
                  }}
                />
                {/* The visible line itself — thin and straight. */}
                <Box
                  position="absolute"
                  left={`${cx - LINE_THICKNESS / 2}px`}
                  top={`${line.topY}px`}
                  width={`${isHovered ? LINE_THICKNESS + 1 : LINE_THICKNESS}px`}
                  height={`${heightPx}px`}
                  bg={lineColor}
                  borderRadius="full"
                  opacity={isHovered ? 1 : 0.95}
                  transition="opacity 100ms ease, width 100ms ease"
                />
              </Box>
            );
          })}
        </Box>
      )}

      {hoveredLineId && tooltipPos && (() => {
        const tipGroup = groups.find((g) => g.id === hoveredLineId);
        return tipGroup ? (
          <ConnectorTooltip group={tipGroup} pos={tooltipPos} />
        ) : null;
      })()}
    </>
  );
};

/**
 * Escape characters that would break a CSS attribute-value string.
 * Backslashes must be escaped first (otherwise the subsequent
 * double-quote escape's own backslash would be re-escaped). Newlines
 * and carriage returns are illegal in CSS strings without the `\A `
 * form. Without this, user-controlled facet values with `\` or
 * line-breaks could break the selector or inject CSS. Exported so a
 * unit test can hammer it with hostile inputs (`</style>`, NUL bytes,
 * the escape sequences themselves) — the escape function is the only
 * thing standing between a malformed search query and arbitrary CSS
 * injection on the page.
 */
export function escapeCssAttributeValue(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\A ")
    .replace(/\r/g, "\\D ");
}

const HoverHighlightStyle: React.FC<{
  group: OrGroup | null;
  facet: { field: string; value: string } | null;
}> = ({ group, facet }) => {
  if (!group && !facet) return null;
  const palette = group ? orGroupColor(group.id) : "blue";
  const escape = escapeCssAttributeValue;
  const memberSelectors: string[] = [];
  if (group) {
    for (const m of group.members) {
      // Match both the search-bar chip span (data-filter-chip-*) and
      // the sidebar row (data-facet-field + data-facet-value). One
      // style block lights up everything that participates.
      memberSelectors.push(
        `[data-filter-chip-field="${escape(m.field)}"][data-filter-chip-value="${escape(m.value)}"]`,
        `[data-facet-field="${escape(m.field)}"][data-facet-value="${escape(m.value)}"]`,
      );
    }
  } else if (facet) {
    memberSelectors.push(
      `[data-filter-chip-field="${escape(facet.field)}"][data-filter-chip-value="${escape(facet.value)}"]`,
      `[data-facet-field="${escape(facet.field)}"][data-facet-value="${escape(facet.value)}"]`,
    );
  }
  if (memberSelectors.length === 0) return null;
  // Background-fill highlight rather than outline. Outlines were
  // getting clipped by parent overflow:hidden (TipTap renders chips
  // inside a contained scroll area) and even when visible they read
  // as a debug ring rather than a confident highlight. The fill ties
  // the chip + sidebar row visually to the OR group's pill colour:
  // same `subtle` background, same `fg` text colour, same `muted`
  // border. `border-radius: inherit` lets the highlight take on
  // whatever shape the chip already has, so it never spills outside
  // a rounded chip into the surrounding text.
  return (
    <style>{`
      ${memberSelectors.join(",\n      ")} {
        background-color: var(--chakra-colors-${palette}-subtle) !important;
        color: var(--chakra-colors-${palette}-fg) !important;
        border-color: var(--chakra-colors-${palette}-muted) !important;
        transition: background-color 100ms ease, color 100ms ease;
      }
    `}</style>
  );
};

const TOOLTIP_WIDTH = 240;
const ConnectorTooltip: React.FC<{
  group: OrGroup;
  pos: { x: number; y: number };
}> = ({ group, pos }) => {
  const palette = orGroupColor(group.id);
  // Anchor just to the right of the cursor — the connector line lives
  // on the sidebar's right edge so there's always space in the
  // adjacent results pane. Clamp against the viewport edges so a
  // bottom-near-edge hover doesn't push the body offscreen.
  const top = Math.min(
    window.innerHeight - 80,
    Math.max(8, pos.y + 8),
  );
  const left = Math.min(
    window.innerWidth - TOOLTIP_WIDTH - 8,
    pos.x + 12,
  );
  return (
    <Box
      position="fixed"
      top={`${top}px`}
      left={`${left}px`}
      width={`${TOOLTIP_WIDTH}px`}
      maxWidth={`${TOOLTIP_WIDTH}px`}
      bg="bg.panel"
      borderWidth="1px"
      borderColor={`${palette}.muted`}
      borderRadius="md"
      paddingX={2.5}
      paddingY={1.5}
      boxShadow="md"
      pointerEvents="none"
      zIndex={2100}
    >
      <Box
        fontSize="2xs"
        color="fg.muted"
        fontWeight="600"
        letterSpacing="0.04em"
        textTransform="uppercase"
        mb={1}
      >
        Linked by OR
      </Box>
      <Box fontSize="xs" fontFamily="mono" lineHeight="1.5">
        {group.members.map((m, i) => (
          <Box key={i}>
            {m.negated && (
              <Box as="span" color={`${palette}.fg`} fontWeight="600">
                NOT&nbsp;
              </Box>
            )}
            <Box as="span" color="fg.muted">
              {m.field}:
            </Box>
            <Box as="span" color="fg" fontWeight="500">
              {m.value}
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  );
};
