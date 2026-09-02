import { Flex, Text } from "@chakra-ui/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DENSE_SPAN_THRESHOLD, ROW_GAP, ROW_HEIGHT, ZOOM_FIT_PADDING } from "../../../model/flame/constants";
import { FlameCanvas } from "./flame-canvas";
import { FlameBreadcrumbs } from "./flame-breadcrumbs";
import { FlameContextStrip } from "./flame-context-strip";
import { buildTree, computeSpanContext, generateTicks } from "../../../behavior/flame/tree";
import type {
  FlameNode,
  FlameRelatedSpanIds,
  FlameViewProps,
  SpanContext,
  Viewport,
} from "../../../behavior/flame/types";
import { useFlameAxisZoom } from "../../../behavior/flame/use-flame-axis-zoom";
import { useFlameKeyboard } from "../../../behavior/flame/use-flame-keyboard";
import { useFlamePanDrag } from "../../../behavior/flame/use-flame-pan-drag";
import { useFlameViewport } from "../../../behavior/flame/use-flame-viewport";

export const FlameView = memo(function FlameView({
  spans,
  selectedSpanId,
  onSelectSpan,
  onClearSpan,
  renderShortcutKey,
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
        if (!(e.target instanceof HTMLElement)) return;
        if (e.target.dataset.flameLayer !== "true") return;
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
    const isCompletelyOutside = node.span.endTimeMs < v.startMs || node.span.startTimeMs > v.endMs;
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
    if (!id) return [];
    const node = tree.byId.get(id);
    if (!node) return [];
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
  const relatedSpanIds = useMemo<FlameRelatedSpanIds | null>(() => {
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
      (n) => n.span.endTimeMs >= viewport.startMs && n.span.startTimeMs <= viewport.endMs,
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
      const widthPct = ((node.span.endTimeMs - node.span.startTimeMs) / dur) * 100;
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
