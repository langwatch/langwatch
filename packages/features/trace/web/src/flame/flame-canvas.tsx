import { Box, Flex, Text } from "@chakra-ui/react";
import type { VirtualItem } from "@tanstack/react-virtual";
import type { MouseEvent, PointerEvent, RefObject } from "react";
import { formatDuration } from "../display-formatters";
import { FlameAxis } from "./flame-axis";
import { FlameRow } from "./flame-row";
import { Minimap } from "./minimap";
import type { FlameNode, FlameRelatedSpanIds, FlameTick, Viewport } from "./types";

export interface FlameCanvasProps {
  flameAreaRef: RefObject<HTMLDivElement | null>;
  timeAxisRef: RefObject<HTMLDivElement | null>;
  viewport: Viewport;
  fullRange: Viewport;
  durationMs: number;
  fullDurationMs: number;
  ticks: FlameTick[];
  relatedSpanIds: FlameRelatedSpanIds | null;
  virtualRows: VirtualItem[];
  blocksByDepth: Map<number, FlameNode[]>;
  allNodes: FlameNode[];
  maxDepth: number;
  totalHeight: number;
  spanCount: number;
  selectedSpanId: string | null;
  hoveredSpanId: string | null;
  focusedSpanId: string | null;
  dimOnHover: boolean;
  dragSelection: Viewport | null;
  hiddenSpanCount: number;
  isZoomed: boolean;
  onTimeAxisPointerDown: (event: PointerEvent) => void;
  onFlamePointerDown: (event: PointerEvent) => void;
  onClearOnEmpty: (event: MouseEvent) => void;
  onSpanClick: (spanId: string) => void;
  onSpanDoubleClick: (spanId: string) => void;
  onHoverChange: (spanId: string | null) => void;
  onViewport: (viewport: Viewport) => void;
  onResetZoom: () => void;
}

/**
 * Controlled flame graph surface: axis, virtualized rows, zoom selection,
 * and minimap layout. View state and application composition stay in
 * FlameView; this component only renders the supplied presentation model.
 */
export function FlameCanvas({
  flameAreaRef,
  timeAxisRef,
  viewport,
  fullRange,
  durationMs,
  fullDurationMs,
  ticks,
  relatedSpanIds,
  virtualRows,
  blocksByDepth,
  allNodes,
  maxDepth,
  totalHeight,
  spanCount,
  selectedSpanId,
  hoveredSpanId,
  focusedSpanId,
  dimOnHover,
  dragSelection,
  hiddenSpanCount,
  isZoomed,
  onTimeAxisPointerDown,
  onFlamePointerDown,
  onClearOnEmpty,
  onSpanClick,
  onSpanDoubleClick,
  onHoverChange,
  onViewport,
  onResetZoom,
}: FlameCanvasProps) {
  return (
    <>
      <FlameAxis
        timeAxisRef={timeAxisRef}
        ticks={ticks}
        viewport={viewport}
        dur={durationMs}
        onPointerDown={onTimeAxisPointerDown}
      />

      <Box
        ref={flameAreaRef}
        flex={1}
        overflow="auto"
        position="relative"
        paddingX={3}
        paddingBottom={2}
        cursor="grab"
        _active={{ cursor: "grabbing" }}
        onPointerDown={onFlamePointerDown}
        onClick={onClearOnEmpty}
        css={{
          "&::-webkit-scrollbar": { width: "4px", height: "4px" },
          "&::-webkit-scrollbar-thumb": {
            borderRadius: "4px",
            background: "var(--chakra-colors-border-muted)",
          },
          "&::-webkit-scrollbar-track": { background: "transparent" },
        }}
      >
        <Box
          data-flame-layer="true"
          position="relative"
          minHeight={`${Math.max(totalHeight, 32)}px`}
          height={`${Math.max(totalHeight, 32)}px`}
          userSelect="none"
        >
          {/* Tick grid lines (full layer height — outside virtualization) */}
          {ticks.map((tick) => {
            const offset = (tick.time - viewport.startMs) / durationMs;
            if (offset < 0 || offset > 1) return null;
            return (
              <Box
                key={`grid-${tick.label}-${tick.time}`}
                position="absolute"
                top={0}
                bottom={0}
                left={`${offset * 100}%`}
                width="1px"
                bg="border.subtle"
                opacity={0.5}
                pointerEvents="none"
              />
            );
          })}

          {/* Parent time-range band: highlights the parent's slice of time when hovering a child */}
          {relatedSpanIds?.parent &&
            (() => {
              const p = relatedSpanIds.parent.span;
              const left =
                durationMs > 0 ? ((p.startTimeMs - viewport.startMs) / durationMs) * 100 : 0;
              const width =
                durationMs > 0 ? ((p.endTimeMs - p.startTimeMs) / durationMs) * 100 : 100;
              if (left + width < 0 || left > 100) return null;
              return (
                <>
                  <Box
                    position="absolute"
                    left={`${left}%`}
                    width={`${width}%`}
                    top={0}
                    bottom={0}
                    bg="bg.emphasized"
                    opacity={0.18}
                    pointerEvents="none"
                    zIndex={0}
                  />
                  <Box
                    position="absolute"
                    left={`${left}%`}
                    top={0}
                    bottom={0}
                    width="1px"
                    bg="fg.muted"
                    opacity={0.5}
                    pointerEvents="none"
                    zIndex={0}
                  />
                  <Box
                    position="absolute"
                    left={`${left + width}%`}
                    top={0}
                    bottom={0}
                    width="1px"
                    bg="fg.muted"
                    opacity={0.5}
                    pointerEvents="none"
                    zIndex={0}
                  />
                </>
              );
            })()}

          {/* Virtualized depth rows — only renders rows visible in the scroll container */}
          {virtualRows.map((virtualRow) => (
            <FlameRow
              key={virtualRow.key}
              virtualRow={virtualRow}
              rowNodes={blocksByDepth.get(virtualRow.index)}
              viewport={viewport}
              fullDur={fullDurationMs}
              totalSpanCount={spanCount}
              selectedSpanId={selectedSpanId}
              hoveredSpanId={hoveredSpanId}
              focusedSpanId={focusedSpanId}
              relatedSpanIds={relatedSpanIds}
              dimOnHover={dimOnHover}
              onSpanClick={onSpanClick}
              onSpanDoubleClick={onSpanDoubleClick}
              onHoverChange={onHoverChange}
            />
          ))}
        </Box>

        {/* Drag-to-zoom selection overlay */}
        {dragSelection &&
          (() => {
            const selDur = dragSelection.endMs - dragSelection.startMs;
            const left =
              durationMs > 0 ? ((dragSelection.startMs - viewport.startMs) / durationMs) * 100 : 0;
            const width = durationMs > 0 ? (selDur / durationMs) * 100 : 0;
            return (
              <Box
                position="absolute"
                top={0}
                bottom={0}
                left={`calc(12px + ${left / 100} * (100% - 24px))`}
                width={`calc(${width / 100} * (100% - 24px))`}
                pointerEvents="none"
                zIndex={20}
              >
                <Box
                  position="absolute"
                  inset={0}
                  bg="blue.solid"
                  opacity={0.18}
                  borderLeftWidth="1.5px"
                  borderRightWidth="1.5px"
                  borderColor="blue.solid"
                />
                <Flex
                  position="absolute"
                  top={1}
                  left="50%"
                  transform="translateX(-50%)"
                  paddingX={2}
                  paddingY={0.5}
                  bg="blue.solid"
                  color="white"
                  borderRadius="sm"
                  boxShadow="md"
                  whiteSpace="nowrap"
                >
                  <Text textStyle="xs" fontWeight="medium">
                    {formatDuration(selDur)}
                  </Text>
                </Flex>
              </Box>
            );
          })()}

        {hiddenSpanCount > 0 && (
          <Flex justify="center" paddingY={1}>
            <Text textStyle="xs" color="fg.subtle">
              {hiddenSpanCount} span{hiddenSpanCount !== 1 ? "s" : ""} too small to display — zoom
              in to see
            </Text>
          </Flex>
        )}
      </Box>

      {/* Minimap — only surfaced once the user has zoomed in. At full
          extent it's a duplicate of what they're already looking at and
          eats vertical space; hiding it by default reclaims that space
          for the flame itself. The Reset-zoom action snaps the viewport
          back to full range, which hides this band again. */}
      {fullDurationMs > 0 && isZoomed && (
        <Minimap
          allNodes={allNodes}
          maxDepth={maxDepth}
          fullRange={fullRange}
          viewport={viewport}
          onViewport={onViewport}
          onReset={onResetZoom}
        />
      )}
    </>
  );
}
