import { Box, chakra, Flex, HStack, Icon, Text } from "@chakra-ui/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type React from "react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LuChevronsDownUp, LuChevronsUpDown, LuSparkles } from "react-icons/lu";
import { Tooltip } from "~/components/ui/tooltip";
import type { SpanTreeNode } from "~/server/api/routers/tracesV2.schemas";
import { useSpanLangwatchSignals } from "../../../hooks/useSpanLangwatchSignals";
import { useDrawerStore } from "../../../stores/drawerStore";
import { formatDuration } from "../../../utils/formatters";
import { GroupRow } from "./GroupRow";
import { GroupTimelineBar, TimelineBar } from "./TimelineBar";
import { TreeRow } from "./TreeRow";
import { buildTree, flattenTree, getTimeMarkers, getTraceRange } from "./tree";
import {
  DEFAULT_TREE_PCT,
  GROUP_ROW_HEIGHT,
  LLM_ROW_HEIGHT,
  MIN_TREE_WIDTH,
  ROW_HEIGHT,
  type WaterfallViewProps,
} from "./types";

export const WaterfallView = memo(function WaterfallView({
  spans,
  selectedSpanId,
  onSelectSpan,
  onClearSpan,
  onSwitchToSpanList,
}: WaterfallViewProps) {
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [treePct, setTreePct] = useState(DEFAULT_TREE_PCT);
  const [hoveredSpanId, setHoveredSpanId] = useState<string | null>(null);
  const [showOnlyLangwatch, setShowOnlyLangwatch] = useState(false);

  // Pin gestures wire straight to the drawer store — `pinnedSpanIds`
  // doubles as both the SpanTabBar tab list and the row-level "is this
  // span pinned" check, so a Set lookup per render is cheaper than
  // recomputing membership inside each row. `pinSpan`/`unpinSpan` are
  // both no-ops on duplicates / unknowns, so the toggle handler is
  // safe to call without first checking membership.
  const pinnedSpanIds = useDrawerStore((s) => s.pinnedSpanIds);
  const pinSpan = useDrawerStore((s) => s.pinSpan);
  const unpinSpan = useDrawerStore((s) => s.unpinSpan);
  const pinnedSet = useMemo(() => new Set(pinnedSpanIds), [pinnedSpanIds]);
  const handleTogglePin = useCallback(
    (spanId: string) => {
      if (pinnedSet.has(spanId)) unpinSpan(spanId);
      else pinSpan(spanId);
    },
    [pinnedSet, pinSpan, unpinSpan],
  );

  const { signalsBySpanId, isFetched: signalsFetched } =
    useSpanLangwatchSignals();
  const hasAnySignals = signalsBySpanId.size > 0;

  const isDraggingDivider = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const treeScrollRef = useRef<HTMLDivElement>(null);
  // Timeline panel does not scroll natively. The tree is the only real scroller;
  // the timeline content's `transform: translateY(...)` follows it, which keeps
  // the two sides perfectly synced (no two-scroller fight, no momentum-scroll
  // race) and avoids the per-frame `scrollTop` write that used to lag.
  const timelineContentRef = useRef<HTMLDivElement>(null);

  // When the toggle is on, keep spans that have signals plus their ancestors
  // so the tree structure stays meaningful (selecting a leaf shouldn't strand
  // it under an invisible parent).
  const filteredSpans = useMemo<SpanTreeNode[]>(() => {
    if (!showOnlyLangwatch) return spans;
    const byId = new Map(spans.map((s) => [s.spanId, s]));
    const kept = new Set<string>();
    for (const span of spans) {
      if ((signalsBySpanId.get(span.spanId)?.length ?? 0) === 0) continue;
      let cursor: SpanTreeNode | undefined = span;
      while (cursor && !kept.has(cursor.spanId)) {
        kept.add(cursor.spanId);
        cursor = cursor.parentSpanId
          ? byId.get(cursor.parentSpanId)
          : undefined;
      }
    }
    return spans.filter((s) => kept.has(s.spanId));
  }, [spans, signalsBySpanId, showOnlyLangwatch]);

  const tree = useMemo(() => buildTree(filteredSpans), [filteredSpans]);
  const flatRows = useMemo(
    () => flattenTree(tree, collapsedIds, expandedGroups),
    [tree, collapsedIds, expandedGroups],
  );
  const { rootStart, rootDuration } = useMemo(
    () => getTraceRange(filteredSpans),
    [filteredSpans],
  );
  const timeMarkers = useMemo(
    () => getTimeMarkers(rootDuration),
    [rootDuration],
  );

  // Drop interior markers when the timeline panel is narrow enough
  // that adjacent labels would collide. Always keep the first + last
  // so the trace's bounds stay readable; the rest are decimated by an
  // integer stride so the remaining marks stay evenly spaced. The
  // ResizeObserver fires on every drag so the count tracks the user's
  // resize in real time.
  const timelinePanelRef = useRef<HTMLDivElement>(null);
  const [timelinePanelWidth, setTimelinePanelWidth] = useState(0);
  useEffect(() => {
    const el = timelinePanelRef.current;
    if (!el) return;
    const measure = () => setTimelinePanelWidth(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const visibleTimeMarkers = useMemo(() => {
    if (timeMarkers.length <= 2) return timeMarkers;
    // Reserve ~60px per label so neighbours don't touch even at the
    // longest "00.0s" duration string. Always show first + last.
    const PER_LABEL_PX = 60;
    const maxLabels = Math.max(
      2,
      Math.floor(timelinePanelWidth / PER_LABEL_PX),
    );
    if (timeMarkers.length <= maxLabels) return timeMarkers;
    const last = timeMarkers.length - 1;
    const interiorBudget = Math.max(0, maxLabels - 2);
    if (interiorBudget === 0) return [timeMarkers[0]!, timeMarkers[last]!];
    const interior = timeMarkers.slice(1, -1);
    const stride = Math.ceil(interior.length / interiorBudget);
    const picked = interior.filter((_, i) => i % stride === 0);
    return [timeMarkers[0]!, ...picked, timeMarkers[last]!];
  }, [timeMarkers, timelinePanelWidth]);

  // Detect multi-root (forest)
  const rootCount = useMemo(() => tree.length, [tree]);

  const handleToggleCollapse = useCallback((spanId: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(spanId)) {
        next.delete(spanId);
      } else {
        next.add(spanId);
      }
      return next;
    });
  }, []);

  const handleToggleGroup = useCallback((groupKey: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupKey)) {
        next.delete(groupKey);
      } else {
        next.add(groupKey);
      }
      return next;
    });
  }, []);

  // Parent spans keyed by depth — drives the Expand More / Collapse
  // More step-through. Built from the same tree the rows render from
  // so the depths line up with what the user sees.
  const parentsByDepth = useMemo(() => {
    const map = new Map<number, string[]>();
    const walk = (nodes: typeof tree) => {
      for (const node of nodes) {
        if (node.children.length > 0) {
          const list = map.get(node.depth) ?? [];
          list.push(node.span.spanId);
          map.set(node.depth, list);
          walk(node.children);
        }
      }
    };
    walk(tree);
    return map;
  }, [tree]);

  const handleCollapseMore = useCallback(() => {
    // Collapse the deepest currently-expanded layer first, then the
    // next layer up on subsequent clicks. Each click peels one level
    // off the tree until only the root remains visible.
    setCollapsedIds((prev) => {
      const depths = [...parentsByDepth.keys()].sort((a, b) => b - a);
      for (const d of depths) {
        const parentsAtDepth = parentsByDepth.get(d) ?? [];
        const stillExpanded = parentsAtDepth.filter((id) => !prev.has(id));
        if (stillExpanded.length === 0) continue;
        const next = new Set(prev);
        for (const id of stillExpanded) next.add(id);
        return next;
      }
      return prev;
    });
  }, [parentsByDepth]);

  const handleExpandMore = useCallback(() => {
    // Inverse of `handleCollapseMore` — reveal the shallowest collapsed
    // layer per click, working back down toward the leaves.
    setCollapsedIds((prev) => {
      if (prev.size === 0) return prev;
      const depths = [...parentsByDepth.keys()].sort((a, b) => a - b);
      for (const d of depths) {
        const parentsAtDepth = parentsByDepth.get(d) ?? [];
        const collapsedAtDepth = parentsAtDepth.filter((id) => prev.has(id));
        if (collapsedAtDepth.length === 0) continue;
        const next = new Set(prev);
        for (const id of collapsedAtDepth) next.delete(id);
        return next;
      }
      return prev;
    });
  }, [parentsByDepth]);

  const handleSelectSpan = useCallback(
    (spanId: string) => {
      if (spanId === selectedSpanId) {
        onClearSpan();
      } else {
        onSelectSpan(spanId);
      }
    },
    [selectedSpanId, onSelectSpan, onClearSpan],
  );

  // Row height estimator for virtualizer
  const getRowHeight = useCallback(
    (index: number) => {
      const row = flatRows[index];
      if (!row) return ROW_HEIGHT;
      if (row.kind === "group") return GROUP_ROW_HEIGHT;
      const isLlm = row.node.span.type === "llm" && row.node.span.model != null;
      return isLlm ? LLM_ROW_HEIGHT : ROW_HEIGHT;
    },
    [flatRows],
  );

  // Single virtualizer drives both panels
  const virtualizer = useVirtualizer({
    count: flatRows.length,
    getScrollElement: () => treeScrollRef.current,
    estimateSize: getRowHeight,
    overscan: 15,
  });

  // Tree drives the timeline via a compositor-only `transform`. The rAF
  // guard collapses bursts of scroll events to one transform write per
  // frame (no React re-render between scrolls).
  const scrollFrameRef = useRef(0);
  const handleTreeScroll = useCallback(() => {
    if (scrollFrameRef.current) return;
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = 0;
      const tree = treeScrollRef.current;
      const timeline = timelineContentRef.current;
      if (tree && timeline) {
        timeline.style.transform = `translateY(${-tree.scrollTop}px)`;
      }
    });
  }, []);

  useEffect(() => {
    return () => {
      if (scrollFrameRef.current) {
        cancelAnimationFrame(scrollFrameRef.current);
        scrollFrameRef.current = 0;
      }
    };
  }, []);

  // The timeline panel itself doesn't scroll. Forward wheel/trackpad gestures
  // over it to the tree so users can scroll from either side.
  const handleTimelineWheel = useCallback((e: React.WheelEvent) => {
    const tree = treeScrollRef.current;
    if (!tree) return;
    tree.scrollTop += e.deltaY;
  }, []);

  // Resizable divider
  const handleDividerStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingDivider.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      if (!isDraggingDivider.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const pct = Math.min(
        0.7,
        Math.max(MIN_TREE_WIDTH / rect.width, x / rect.width),
      );
      setTreePct(pct);
    };

    const handleUp = () => {
      if (!isDraggingDivider.current) return;
      isDraggingDivider.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, []);

  if (spans.length === 0) {
    return (
      <Flex align="center" justify="center" height="full">
        <Text textStyle="xs" color="fg.subtle">
          No span data available for this trace
        </Text>
      </Flex>
    );
  }

  return (
    <Flex
      ref={containerRef}
      direction="row"
      height="full"
      overflow="hidden"
      width="full"
      position="relative"
    >
      {/* Tree panel */}
      <Flex
        direction="column"
        width={`${treePct * 100}%`}
        minWidth={`${MIN_TREE_WIDTH}px`}
        flexShrink={0}
        height="full"
        overflow="hidden"
      >
        {/* Tree header */}
        <Flex
          align="center"
          justify="space-between"
          paddingX={2}
          paddingY={0.5}
          height="24px"
          flexShrink={0}
          borderBottomWidth="1px"
          borderColor="border.subtle"
          bg="bg.subtle/30"
        >
          <Text textStyle="xs" color="fg.subtle" fontWeight="medium">
            Span
          </Text>
          <HStack gap={0}>
            {(hasAnySignals || !signalsFetched) && (
              <Tooltip
                content={
                  showOnlyLangwatch
                    ? "Showing only LangWatch-instrumented spans"
                    : "Show only LangWatch-instrumented spans"
                }
                positioning={{ placement: "top" }}
              >
                <chakra.button
                  display="flex"
                  alignItems="center"
                  justifyContent="center"
                  width="20px"
                  height="20px"
                  borderRadius="sm"
                  cursor="pointer"
                  color={showOnlyLangwatch ? "purple.fg" : "fg.subtle"}
                  bg={showOnlyLangwatch ? "purple.subtle" : undefined}
                  _hover={{
                    color: showOnlyLangwatch ? "purple.fg" : "fg.muted",
                    bg: showOnlyLangwatch ? "purple.subtle" : "bg.muted",
                  }}
                  disabled={!hasAnySignals}
                  opacity={hasAnySignals ? 1 : 0.4}
                  onClick={() => setShowOnlyLangwatch((v) => !v)}
                  aria-pressed={showOnlyLangwatch}
                >
                  <Icon as={LuSparkles} boxSize={3} />
                </chakra.button>
              </Tooltip>
            )}
            <ToolbarIconButton
              tooltip="Expand one level"
              icon={LuChevronsUpDown}
              onClick={handleExpandMore}
            />
            <ToolbarIconButton
              tooltip="Collapse one level"
              icon={LuChevronsDownUp}
              onClick={handleCollapseMore}
            />
          </HStack>
        </Flex>

        {/* Tree rows (virtualized) */}
        <Box
          ref={treeScrollRef}
          flex={1}
          overflowY="auto"
          overflowX="hidden"
          onScroll={handleTreeScroll}
          css={{
            "&::-webkit-scrollbar": { width: "4px" },
            "&::-webkit-scrollbar-thumb": {
              borderRadius: "4px",
              background: "var(--chakra-colors-border-muted)",
            },
            "&::-webkit-scrollbar-track": { background: "transparent" },
          }}
        >
          <Box
            position="relative"
            height={`${virtualizer.getTotalSize()}px`}
            width="full"
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const row = flatRows[virtualRow.index]!;
              const i = virtualRow.index;

              if (row.kind === "group") {
                return (
                  <Box
                    key={`group-${row.parentSpanId}-${row.name}`}
                    position="absolute"
                    top={0}
                    left={0}
                    width="full"
                    height={`${virtualRow.size}px`}
                    transform={`translateY(${virtualRow.start}px)`}
                  >
                    <GroupRow
                      group={row}
                      isExpanded={expandedGroups.has(
                        `${row.parentSpanId}::${row.name}`,
                      )}
                      onToggle={() =>
                        handleToggleGroup(`${row.parentSpanId}::${row.name}`)
                      }
                      onSwitchToSpanList={onSwitchToSpanList}
                    />
                  </Box>
                );
              }
              const { node } = row;
              const isRoot = node.depth === 0;
              const showSeparator = isRoot && rootCount > 1 && i > 0;
              return (
                <Box
                  key={node.span.spanId}
                  position="absolute"
                  top={0}
                  left={0}
                  width="full"
                  height={`${virtualRow.size}px`}
                  transform={`translateY(${virtualRow.start}px)`}
                >
                  {showSeparator && (
                    <Box
                      height="1px"
                      bg="border.subtle"
                      marginX={2}
                      position="absolute"
                      top={0}
                      left={0}
                      right={0}
                    />
                  )}
                  <TreeRow
                    node={node}
                    rootStart={rootStart}
                    rootDuration={rootDuration}
                    isSelected={node.span.spanId === selectedSpanId}
                    isHovered={node.span.spanId === hoveredSpanId}
                    isPinned={pinnedSet.has(node.span.spanId)}
                    isCollapsed={collapsedIds.has(node.span.spanId)}
                    hasChildren={node.children.length > 0}
                    isDimmed={
                      selectedSpanId !== null &&
                      node.span.spanId !== selectedSpanId
                    }
                    signals={signalsBySpanId.get(node.span.spanId) ?? []}
                    onToggleCollapse={() =>
                      handleToggleCollapse(node.span.spanId)
                    }
                    onSelect={() => handleSelectSpan(node.span.spanId)}
                    onTogglePin={() => handleTogglePin(node.span.spanId)}
                    onHoverStart={() => setHoveredSpanId(node.span.spanId)}
                    onHoverEnd={() => setHoveredSpanId(null)}
                  />
                </Box>
              );
            })}
          </Box>
        </Box>
      </Flex>

      {/* Resizable divider */}
      <Box
        width="5px"
        flexShrink={0}
        cursor="col-resize"
        position="relative"
        zIndex={2}
        onMouseDown={handleDividerStart}
        _hover={{
          "& > div": { opacity: 1, bg: "blue.solid" },
        }}
      >
        <Box
          position="absolute"
          top={0}
          bottom={0}
          left="2px"
          width="1px"
          // Light mode: lean on the darker `border.emphasized` token so
          // the divider doesn't vanish against the white-ish surface.
          // Dark mode: drop to the regular `border` token (and a lower
          // opacity) — `border.emphasized` reads brighter than the
          // panel separators around it, which looked off-key in the
          // dark theme.
          bg={{ base: "border.emphasized", _dark: "border" }}
          opacity={0.5}
          transition="all 0.15s ease"
        />
      </Box>

      {/* Timeline panel */}
      <Flex
        ref={timelinePanelRef}
        direction="column"
        flex={1}
        minWidth={0}
        height="full"
        overflow="hidden"
      >
        {/* Time axis header — time markers share the same right inset as
            the bars below so labels and bars align vertically. */}
        <Flex
          align="center"
          position="relative"
          height="24px"
          flexShrink={0}
          borderBottomWidth="1px"
          borderColor="border.subtle"
          bg="bg.subtle/30"
        >
          <Box
            position="absolute"
            top={0}
            bottom={0}
            left={2}
            right={4}
          >
            {visibleTimeMarkers.map((ms, idx) => {
              const pct = rootDuration > 0 ? (ms / rootDuration) * 100 : 0;
              const isLast = idx === visibleTimeMarkers.length - 1;
              const isFirst = idx === 0;
              return (
                <Text
                  key={idx}
                  textStyle="xs"
                  color="fg.subtle"
                  position="absolute"
                  top="50%"
                  left={`${pct}%`}
                  transform={
                    isLast
                      ? "translate(-100%, -50%)"
                      : isFirst
                        ? "translateY(-50%)"
                        : "translate(-50%, -50%)"
                  }
                  whiteSpace="nowrap"
                  userSelect="none"
                  lineHeight={1}
                >
                  {formatDuration(ms)}
                </Text>
              );
            })}
          </Box>
        </Flex>

        {/* Timeline rows — driven by the tree's scroll position via transform.
            No native scrollbar here; wheel events delegate to the tree.
            Right inset is applied per-bar (in TimelineBar) rather than
            on this container so the row's hover / selection background
            still extends edge-to-edge while only the bars + time
            labels stay clear of the pane edge. */}
        <Box
          flex={1}
          overflow="hidden"
          position="relative"
          onWheel={handleTimelineWheel}
        >
          <Box
            ref={timelineContentRef}
            position="relative"
            height={`${virtualizer.getTotalSize()}px`}
            width="full"
            style={{ willChange: "transform" }}
          >
            {/* Vertical grid lines — inset to match the bars and time
                marker labels so the alignment grid is consistent. */}
            <Box
              position="absolute"
              top={0}
              bottom={0}
              left={2}
              right={4}
              pointerEvents="none"
              zIndex={0}
            >
              {visibleTimeMarkers.map((ms, idx) => {
                const pct = rootDuration > 0 ? (ms / rootDuration) * 100 : 0;
                return (
                  <Box
                    key={idx}
                    position="absolute"
                    left={`${pct}%`}
                    top={0}
                    bottom={0}
                    width="1px"
                    bg="border.subtle"
                    opacity={0.3}
                  />
                );
              })}
            </Box>

            {virtualizer.getVirtualItems().map((virtualRow) => {
              const row = flatRows[virtualRow.index]!;

              if (row.kind === "group") {
                return (
                  <Box
                    key={`group-tl-${row.parentSpanId}-${row.name}`}
                    position="absolute"
                    top={0}
                    left={0}
                    width="full"
                    height={`${virtualRow.size}px`}
                    transform={`translateY(${virtualRow.start}px)`}
                  >
                    <GroupTimelineBar
                      group={row}
                      rootStart={rootStart}
                      rootDuration={rootDuration}
                    />
                  </Box>
                );
              }
              const { node } = row;
              return (
                <Box
                  key={node.span.spanId}
                  position="absolute"
                  top={0}
                  left={0}
                  width="full"
                  height={`${virtualRow.size}px`}
                  transform={`translateY(${virtualRow.start}px)`}
                >
                  <TimelineBar
                    span={node.span}
                    rootStart={rootStart}
                    rootDuration={rootDuration}
                    rowHeight={virtualRow.size}
                    isSelected={node.span.spanId === selectedSpanId}
                    isHovered={node.span.spanId === hoveredSpanId}
                    isDimmed={
                      selectedSpanId !== null &&
                      node.span.spanId !== selectedSpanId
                    }
                    onSelect={() => handleSelectSpan(node.span.spanId)}
                    onHoverStart={() => setHoveredSpanId(node.span.spanId)}
                    onHoverEnd={() => setHoveredSpanId(null)}
                  />
                </Box>
              );
            })}
          </Box>
        </Box>
      </Flex>
    </Flex>
  );
});

function ToolbarIconButton({
  tooltip,
  icon,
  onClick,
}: {
  tooltip: string;
  icon: React.ComponentType;
  onClick: () => void;
}) {
  return (
    <Tooltip content={tooltip} positioning={{ placement: "top" }}>
      <Flex
        as="button"
        align="center"
        justify="center"
        width="20px"
        height="20px"
        borderRadius="sm"
        cursor="pointer"
        color="fg.subtle"
        _hover={{ color: "fg.muted", bg: "bg.muted" }}
        onClick={onClick}
      >
        <Icon as={icon} boxSize={3} />
      </Flex>
    </Tooltip>
  );
}
