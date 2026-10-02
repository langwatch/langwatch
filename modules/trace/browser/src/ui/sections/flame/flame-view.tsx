import { Flex, Text } from "@langwatch/design-system/primitives";
import { useVirtualizer } from "@tanstack/react-virtual";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  buildTree,
  fitViewport,
  followViewport,
  fullRangeOf,
  generateTicks,
  groupByDepth,
  hiddenSpanCountOf,
  isEmptyFlameClick,
  nodesInViewport,
} from "../../../behavior/flame/tree.ts";
import type { FlameViewProps } from "../../../behavior/flame/types.ts";
import { useFlameAxisZoom } from "../../../behavior/flame/use-flame-axis-zoom.ts";
import { useFlameFocus } from "../../../behavior/flame/use-flame-focus.ts";
import { useFlameKeyboard } from "../../../behavior/flame/use-flame-keyboard.ts";
import { useFlamePanDrag } from "../../../behavior/flame/use-flame-pan-drag.ts";
import { useFlameViewport } from "../../../behavior/flame/use-flame-viewport.ts";
import { DENSE_SPAN_THRESHOLD, ROW_GAP, ROW_HEIGHT } from "../../../model/flame/constants.ts";
import { FlameBreadcrumbs } from "./flame-breadcrumbs.tsx";
import { FlameCanvas } from "./flame-canvas.tsx";
import { FlameContextStrip } from "./flame-context-strip.tsx";

export const FlameView = memo(function FlameView({
  spans,
  selectedSpanId,
  onSelectSpan,
  onClearSpan,
  renderShortcutKey,
}: FlameViewProps) {
  const tree = useMemo(() => buildTree(spans), [spans]);

  const fullRange = useMemo(() => fullRangeOf(spans), [spans]);

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
      animateTo(fitViewport(node));
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
      if (!isPanningRef.current && isEmptyFlameClick(e)) onClearSpan();
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
    const node = selectedSpanId ? tree.byId.get(selectedSpanId) : undefined;
    const next = node && followViewport({ node, viewport: viewportRef.current });
    if (next) animateTo(next);
  }, [selectedSpanId, tree.byId, animateTo, viewportRef]);

  // Ancestor chain of the focus span for breadcrumb navigation.
  const { breadcrumbs, contextNode, contextInfo, relatedSpanIds } = useFlameFocus({
    tree,
    fullRange,
    hoveredSpanId,
    focusedSpanId,
    selectedSpanId,
  });

  const visibleBlocks = useMemo(
    () => nodesInViewport({ nodes: tree.all, viewport }),
    [tree.all, viewport],
  );
  // Grouped by depth so each virtual row reads only its own blocks.
  const blocksByDepth = useMemo(() => groupByDepth(visibleBlocks), [visibleBlocks]);
  const hiddenSpanCount = useMemo(
    () => hiddenSpanCountOf({ nodes: visibleBlocks, durationMs: dur }),
    [visibleBlocks, dur],
  );

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
          renderShortcutKey={renderShortcutKey}
        />
      )}

      {/* Context strip: parent ratio + trace ratio for hovered/focused span */}
      <FlameContextStrip
        contextNode={contextNode}
        contextInfo={contextInfo}
        spanCount={spans.length}
        fullDur={fullDur}
        // Dense traces at full extent get an active zoom prompt instead of
        // the passive hover hint — once zoomed the Minimap takes over as
        // the navigation affordance, so the prompt steps back down.
        showZoomHint={spans.length > DENSE_SPAN_THRESHOLD && !isZoomed}
      />

      <FlameCanvas
        flameAreaRef={flameAreaRef}
        timeAxisRef={timeAxisRef}
        viewport={viewport}
        fullRange={fullRange}
        durationMs={dur}
        fullDurationMs={fullDur}
        ticks={ticks}
        relatedSpanIds={relatedSpanIds}
        virtualRows={virtualRows}
        blocksByDepth={blocksByDepth}
        allNodes={tree.all}
        maxDepth={tree.maxDepth}
        totalHeight={totalHeight}
        spanCount={spans.length}
        selectedSpanId={selectedSpanId}
        hoveredSpanId={hoveredSpanId}
        focusedSpanId={focusedSpanId}
        dimOnHover={dimOnHover}
        dragSelection={dragSelection}
        hiddenSpanCount={hiddenSpanCount}
        isZoomed={isZoomed}
        onTimeAxisPointerDown={handleTimeAxisPointerDown}
        onFlamePointerDown={handlePointerDown}
        onClearOnEmpty={handleClearOnEmpty}
        onSpanClick={handleSpanClick}
        onSpanDoubleClick={handleSpanDoubleClick}
        onHoverChange={setHoveredSpanId}
        onViewport={(nextViewport) => {
          cancelAnimation();
          setViewport(clampViewport(nextViewport));
        }}
        onResetZoom={handleResetZoom}
      />
    </Flex>
  );
});
