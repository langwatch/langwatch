import { Box } from "@chakra-ui/react";
import type React from "react";
import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import type { OrGroup } from "~/server/app-layer/traces/query-language/queries";
import { useFacetHoverStore } from "../../stores/facetHoverStore";
import { ConnectorTooltip } from "./ConnectorTooltip";
import { HoverHighlightStyle } from "./HoverHighlightStyle";
import {
  type OrGroupPaletteColor,
  orGroupColor,
} from "./orGroupPalette";

const LANE_WIDTH = 14;
const LINE_THICKNESS = 2;
const HIT_AREA_WIDTH = 10;

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
  palette: OrGroupPaletteColor;
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
  // given group doesn't shuffle between renders. Memoised so downstream
  // consumers (the layout effect, the JSX render loop, the overlay
  // width calc) all see the same array reference unless `groups` itself
  // actually changes.
  const sortedGroups = useMemo(
    () => [...groups].sort((a, b) => a.id.localeCompare(b.id)),
    [groups],
  );

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
