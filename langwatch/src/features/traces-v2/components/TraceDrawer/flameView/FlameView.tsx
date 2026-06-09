import { Box, Flex, Text } from "@chakra-ui/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatDuration } from "../../../utils/formatters";
import {
  ROW_GAP,
  ROW_HEIGHT,
  ZOOM_FIT_PADDING,
} from "./constants";
import { FlameAxis } from "./FlameAxis";
import { FlameBreadcrumbs } from "./FlameBreadcrumbs";
import { FlameContextStrip } from "./FlameContextStrip";
import { FlameRow } from "./FlameRow";
import { Minimap } from "./Minimap";
import { buildTree, computeSpanContext, generateTicks } from "./tree";
import type { FlameNode, FlameViewProps, SpanContext, Viewport } from "./types";
import { useFlameAxisZoom } from "./useFlameAxisZoom";
import { useFlamePanDrag } from "./useFlamePanDrag";
import { useFlameKeyboard } from "./useFlameKeyboard";
import { useFlameViewport } from "./useFlameViewport";

export const FlameView = memo(function FlameView({
  spans,
  selectedSpanId,
  onSelectSpan,
  onClearSpan,
}: FlameViewProps) {
  const tree = useMemo(() => buildTree(spans), [spans]);

  const fullRange = useMemo<Viewport>(() => {
    if (spans.length === 0) return { startMs: 0, endMs: 0 };
    let start = Infinity;
    let end = -Infinity;
    for (const s of spans) {
      if (s.startTimeMs < start) start = s.startTimeMs;
      if (s.endTimeMs > end) end = s.endTimeMs;
    }
    return { startMs: start, endMs: end };
  }, [spans]);

  const [hoveredSpanId, setHoveredSpanId] = useState<string | null>(null);
  const [focusedSpanId, setFocusedSpanId] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const flameAreaRef = useRef<HTMLDivElement>(null);
  const timeAxisRef = useRef<HTMLDivElement>(null);

  const { viewport, setViewport, viewportRef, clampViewport, animateTo, cancelAnimation } =
    useFlameViewport({ fullRange, flameAreaRef });

  const { isPanningRef, handlePointerDown } = useFlamePanDrag({
    flameAreaRef,
    viewportRef,
    cancelAnimation,
    clampViewport,
    setViewport,
  });

  const { dragSelection, handleTimeAxisPointerDown } = useFlameAxisZoom({
    timeAxisRef,
    viewportRef,
    cancelAnimation,
    animateTo,
  });

  const handleResetZoom = useCallback(() => {
    animateTo(fullRange);
  }, [animateTo, fullRange]);

  const handleSpanDoubleClick = useCallback(
    (spanId: string) => {
      const node = tree.byId.get(spanId);
      if (!node) return;
      const dur = node.span.endTimeMs - node.span.startTimeMs;
      const pad = Math.max(dur * ZOOM_FIT_PADDING, 0);
      animateTo({
        startMs: node.span.startTimeMs - pad,
        endMs: node.span.endTimeMs + pad,
      });
      onSelectSpan(spanId);
      setFocusedSpanId(spanId);
    },
    [tree.byId, animateTo, onSelectSpan],
  );

  const handleSpanClick = useCallback(
    (spanId: string) => {
      if (isPanningRef.current) return;
      onSelectSpan(spanId);
      setFocusedSpanId(spanId);
    },
    [onSelectSpan, isPanningRef],
  );

  const handleClearOnEmpty = useCallback(
    (e: React.MouseEvent) => {
      if (isPanningRef.current) return;
      // Only fire when click landed on the flame area itself (not a span).
      // Span onClick stops propagation, so this is the empty-space case.
      if (e.target !== e.currentTarget) {
        // Allow inner content box too (the absolute layer).
        const target = e.target as HTMLElement;
        if (target.dataset.flameLayer !== "true") return;
      }
      onClearSpan();
    },
    [onClearSpan, isPanningRef],
  );

  const dur = viewport.endMs - viewport.startMs;
  const fullDur = fullRange.endMs - fullRange.startMs;
  const isZoomed = fullDur > 0 && dur < fullDur * 0.999;

  useFlameKeyboard({
    containerRef,
    tree,
    fullDur,
    selectedSpanId,
    focusedSpanId,
    setFocusedSpanId,
    viewportRef,
    setViewport,
    clampViewport,
    handleResetZoom,
    handleSpanDoubleClick,
    onClearSpan,
    onSelectSpan,
  });

  // Selection-follow: when a span is selected externally and falls fully outside
  // the current viewport, animate the viewport to bring it back into view.
  useEffect(() => {
    if (!selectedSpanId) return;
    const node = tree.byId.get(selectedSpanId);
    if (!node) return;
    const v = viewportRef.current;
    const isCompletelyOutside =
      node.span.endTimeMs < v.startMs || node.span.startTimeMs > v.endMs;
    if (!isCompletelyOutside) return;
    const nodeDur = node.span.endTimeMs - node.span.startTimeMs;
    const vpDur = v.endMs - v.startMs;
    if (nodeDur < vpDur * 0.5) {
      // Span is small relative to current zoom — keep zoom level, just center it.
      const center = (node.span.startTimeMs + node.span.endTimeMs) / 2;
      animateTo({
        startMs: center - vpDur / 2,
        endMs: center + vpDur / 2,
      });
    } else {
      const pad = Math.max(nodeDur * ZOOM_FIT_PADDING, 0);
      animateTo({
        startMs: node.span.startTimeMs - pad,
        endMs: node.span.endTimeMs + pad,
      });
    }
  }, [selectedSpanId, tree.byId, animateTo, viewportRef]);

  // Ancestor chain of the focus span for breadcrumb navigation.
  const breadcrumbs = useMemo(() => {
    const id = focusedSpanId ?? selectedSpanId;
    if (!id) return [] as FlameNode[];
    const node = tree.byId.get(id);
    if (!node) return [] as FlameNode[];
    const chain: FlameNode[] = [];
    let curr: FlameNode | null = node;
    while (curr) {
      chain.unshift(curr);
      curr = curr.parent;
    }
    return chain;
  }, [focusedSpanId, selectedSpanId, tree.byId]);

  // Context span for the info strip: priority hover > focus > selection.
  const contextNode = useMemo<FlameNode | null>(() => {
    const id = hoveredSpanId ?? focusedSpanId ?? selectedSpanId;
    return id ? (tree.byId.get(id) ?? null) : null;
  }, [hoveredSpanId, focusedSpanId, selectedSpanId, tree.byId]);

  const contextInfo = useMemo<SpanContext | null>(() => {
    if (!contextNode) return null;
    return computeSpanContext(contextNode, fullRange);
  }, [contextNode, fullRange]);

  // Ancestors and descendants of the context span: drives relationship highlights.
  const relatedSpanIds = useMemo<{
    ancestors: Set<string>;
    descendants: Set<string>;
    parent: FlameNode | null;
    children: Set<string>;
  } | null>(() => {
    if (!contextNode) return null;
    const ancestors = new Set<string>();
    const descendants = new Set<string>();
    const childIds = new Set<string>();
    let curr = contextNode.parent;
    while (curr) {
      ancestors.add(curr.span.spanId);
      curr = curr.parent;
    }
    function collectDesc(n: FlameNode) {
      for (const c of n.children) {
        descendants.add(c.span.spanId);
        collectDesc(c);
      }
    }
    collectDesc(contextNode);
    for (const c of contextNode.children) childIds.add(c.span.spanId);
    return {
      ancestors,
      descendants,
      parent: contextNode.parent,
      children: childIds,
    };
  }, [contextNode]);

  const visibleBlocks = useMemo(() => {
    if (dur <= 0) return tree.all;
    return tree.all.filter(
      (n) =>
        n.span.endTimeMs >= viewport.startMs &&
        n.span.startTimeMs <= viewport.endMs,
    );
  }, [tree.all, viewport.startMs, viewport.endMs, dur]);

  // Group visible blocks by depth so the virtualizer can render each row's
  // contents independently without scanning the full list per row.
  const blocksByDepth = useMemo(() => {
    const map = new Map<number, FlameNode[]>();
    for (const node of visibleBlocks) {
      const list = map.get(node.depth);
      if (list) list.push(node);
      else map.set(node.depth, [node]);
    }
    return map;
  }, [visibleBlocks]);

  const hiddenSpanCount = useMemo(() => {
    if (visibleBlocks.length <= 200) return 0;
    let count = 0;
    for (const node of visibleBlocks) {
      const widthPct =
        ((node.span.endTimeMs - node.span.startTimeMs) / dur) * 100;
      if (widthPct < 0.1) count++;
    }
    return count;
  }, [visibleBlocks, dur]);

  const ticks = useMemo(
    () => generateTicks(viewport, fullRange.startMs),
    [viewport, fullRange.startMs],
  );

  const rowSize = ROW_HEIGHT + ROW_GAP;
  const totalHeight = (tree.maxDepth + 1) * rowSize;

  // Virtualize one row per depth level. The flame area itself is the scroll
  // container — `getScrollElement` returns its ref. Each virtual item renders
  // the depth-stripe + the spans at that depth (positioned absolutely in time).
  const getScrollElement = useCallback(() => flameAreaRef.current, []);
  const estimateSize = useCallback(() => rowSize, [rowSize]);

  const virtualizer = useVirtualizer({
    count: tree.maxDepth + 1,
    getScrollElement,
    estimateSize,
    overscan: 4,
  });

  const virtualRows = virtualizer.getVirtualItems();

  if (spans.length === 0) {
    return (
      <Flex align="center" justify="center" height="full">
        <Text textStyle="xs" color="fg.subtle">
          No span data available
        </Text>
      </Flex>
    );
  }

  const dimOnHover = spans.length <= 100;

  return (
    <Flex
      ref={containerRef}
      direction="column"
      height="full"
      overflow="hidden"
      position="relative"
      tabIndex={0}
      outline="none"
      _focusVisible={{ outline: "none" }}
    >
      {/* Top bar: breadcrumbs + reset */}
      {(isZoomed || breadcrumbs.length > 0) && (
        <FlameBreadcrumbs
          breadcrumbs={breadcrumbs}
          isZoomed={isZoomed}
          onResetZoom={handleResetZoom}
          onSpanDoubleClick={handleSpanDoubleClick}
        />
      )}

      {/* Context strip: parent ratio + trace ratio for hovered/focused span */}
      <FlameContextStrip
        contextNode={contextNode}
        contextInfo={contextInfo}
        spanCount={spans.length}
        fullDur={fullDur}
      />

      {/* Time axis: drag to zoom into a range */}
      <FlameAxis
        timeAxisRef={timeAxisRef}
        ticks={ticks}
        viewport={viewport}
        dur={dur}
        onPointerDown={handleTimeAxisPointerDown}
      />

      {/* Flame area — vertical scroll container for the row virtualizer */}
      <Box
        ref={flameAreaRef}
        flex={1}
        overflow="auto"
        position="relative"
        paddingX={3}
        paddingBottom={2}
        cursor="grab"
        _active={{ cursor: "grabbing" }}
        onPointerDown={handlePointerDown}
        onClick={handleClearOnEmpty}
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
            const offset = (tick.time - viewport.startMs) / dur;
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
                dur > 0 ? ((p.startTimeMs - viewport.startMs) / dur) * 100 : 0;
              const width =
                dur > 0 ? ((p.endTimeMs - p.startTimeMs) / dur) * 100 : 100;
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
              fullDur={fullDur}
              totalSpanCount={spans.length}
              selectedSpanId={selectedSpanId}
              hoveredSpanId={hoveredSpanId}
              focusedSpanId={focusedSpanId}
              relatedSpanIds={relatedSpanIds}
              dimOnHover={dimOnHover}
              onSpanClick={handleSpanClick}
              onSpanDoubleClick={handleSpanDoubleClick}
              onHoverChange={setHoveredSpanId}
            />
          ))}
        </Box>

        {/* Drag-to-zoom selection overlay */}
        {dragSelection &&
          (() => {
            const selDur = dragSelection.endMs - dragSelection.startMs;
            const left =
              dur > 0
                ? ((dragSelection.startMs - viewport.startMs) / dur) * 100
                : 0;
            const width = dur > 0 ? (selDur / dur) * 100 : 0;
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
              {hiddenSpanCount} span{hiddenSpanCount !== 1 ? "s" : ""} too small
              to display — zoom in to see
            </Text>
          </Flex>
        )}
      </Box>

      {/* Minimap — only surfaced once the user has zoomed in. At full
          extent it's a duplicate of what they're already looking at and
          eats vertical space; hiding it by default reclaims that space
          for the flame itself. The Reset-zoom action snaps the viewport
          back to full range, which hides this band again. */}
      {fullDur > 0 && isZoomed && (
        <Minimap
          allNodes={tree.all}
          maxDepth={tree.maxDepth}
          fullRange={fullRange}
          viewport={viewport}
          onViewport={(v) => {
            cancelAnimation();
            setViewport(clampViewport(v));
          }}
          onReset={handleResetZoom}
        />
      )}
    </Flex>
  );
});
