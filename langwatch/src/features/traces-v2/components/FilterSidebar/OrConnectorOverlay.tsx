import { Box } from "@chakra-ui/react";
import type React from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { OrGroup } from "~/server/app-layer/traces/query-language/queries";

const LANE_WIDTH = 16;
const TICK_WIDTH = 12;
const LINE_THICKNESS = 3;

/**
 * Six well-spaced pastel hues — must match the palette in
 * `SidebarSection` and `FacetRow` so a group's pill, row outline, and
 * connector line all share one colour.
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
  topPct: number;
  bottomPct: number;
  ticks: number[]; // centerY in container px
}

/**
 * SVG overlay that paints vertical connector lines linking the rows of
 * each cross-facet OR group. Lines live in their own per-group lane on
 * the right gutter of the sidebar; the gutter's width is reserved by
 * `FilterAside`'s width calc (one lane per active OR group). Each line
 * runs from the first to the last visible member row of its group with
 * a horizontal tick at every member — the result reads as a literal
 * bracket joining the rows that are linked by OR.
 *
 * Reads row positions via `[data-or-group]` data-attrs every layout
 * pass (and on resize/scroll) so the lines stay aligned through facet
 * collapse / expand and sidebar scrolling.
 */
export const OrConnectorOverlay: React.FC<OrConnectorOverlayProps> = ({
  groups,
  containerRef,
}) => {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(
    null,
  );
  const [lines, setLines] = useState<LineGeometry[]>([]);

  // Stable lane assignment: sort groups by id so the lane index for a
  // given group doesn't shuffle between renders, which would re-paint
  // the rows in a different colour.
  const sortedGroups = [...groups].sort((a, b) => a.id.localeCompare(b.id));

  const recompute = (): void => {
    const container = containerRef.current;
    const overlay = overlayRef.current;
    if (!container || !overlay) return;
    const containerRect = container.getBoundingClientRect();
    setSize({
      width: sortedGroups.length * LANE_WIDTH,
      height: containerRect.height,
    });
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
        topPct: Math.min(...centers),
        bottomPct: Math.max(...centers),
        ticks: centers,
      });
    });
    setLines(next);
  };

  // Re-measure whenever the layout could shift: on mount, on group
  // changes, on container resize, on container scroll.
  useLayoutEffect(() => {
    recompute();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, containerRef]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(recompute);
    observer.observe(container);
    container.addEventListener("scroll", recompute, true);
    return () => {
      observer.disconnect();
      container.removeEventListener("scroll", recompute, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef, groups]);

  if (sortedGroups.length === 0) return null;

  return (
    <Box
      ref={overlayRef}
      position="absolute"
      top={0}
      right={0}
      width={`${sortedGroups.length * LANE_WIDTH}px`}
      bottom={0}
      pointerEvents="none"
      zIndex={2}
    >
      {lines.map((line) => {
        const cx = line.laneIndex * LANE_WIDTH + LANE_WIDTH / 2;
        const lineColor = `var(--chakra-colors-${line.palette}-solid)`;
        return (
          <Box key={line.groupId} position="absolute" inset={0}>
            {/* Vertical spine */}
            <Box
              position="absolute"
              left={`${cx - LINE_THICKNESS / 2}px`}
              top={`${line.topPct}px`}
              width={`${LINE_THICKNESS}px`}
              height={`${line.bottomPct - line.topPct}px`}
              bg={lineColor}
              borderRadius="full"
              opacity={0.85}
            />
            {/* One tick per member row — a short horizontal mark
                pointing left toward the row, so the link is explicit
                rather than just "rows happen to share a colour." */}
            {line.ticks.map((y, i) => (
              <Box
                key={i}
                position="absolute"
                left={`${cx - TICK_WIDTH}px`}
                top={`${y - LINE_THICKNESS / 2}px`}
                width={`${TICK_WIDTH}px`}
                height={`${LINE_THICKNESS}px`}
                bg={lineColor}
                borderRadius="full"
                opacity={0.85}
              />
            ))}
          </Box>
        );
      })}
    </Box>
  );
};
