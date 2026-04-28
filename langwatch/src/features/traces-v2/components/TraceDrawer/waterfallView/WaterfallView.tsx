import { Box, Flex, HStack, Icon, Text } from "@chakra-ui/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LuChevronsDownUp, LuChevronsUpDown } from "react-icons/lu";
import { Tooltip } from "~/components/ui/tooltip";
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

  const isDraggingDivider = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const treeScrollRef = useRef<HTMLDivElement>(null);
  // Timeline panel does not scroll natively. The tree is the only real scroller;
  // the timeline content's `transform: translateY(...)` follows it, which keeps
  // the two sides perfectly synced (no two-scroller fight, no momentum-scroll
  // race) and avoids the per-frame `scrollTop` write that used to lag.
  const timelineContentRef = useRef<HTMLDivElement>(null);

  const tree = useMemo(() => buildTree(spans), [spans]);
  const flatRows = useMemo(
    () => flattenTree(tree, collapsedIds, expandedGroups),
    [tree, collapsedIds, expandedGroups],
  );
  const { rootStart, rootDuration } = useMemo(
    () => getTraceRange(spans),
    [spans],
  );
  const timeMarkers = useMemo(
    () => getTimeMarkers(rootDuration),
    [rootDuration],
  );

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

  const handleExpandAll = useCallback(() => {
    setCollapsedIds(new Set());
  }, []);

  const handleCollapseAll = useCallback(() => {
    const parentIds = new Set<string>();
    for (const span of spans) {
      if (spans.some((s) => s.parentSpanId === span.spanId)) {
        parentIds.add(span.spanId);
      }
    }
    setCollapsedIds(parentIds);
  }, [spans]);

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
            <Tooltip content="Expand all" positioning={{ placement: "top" }}>
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
                onClick={handleExpandAll}
              >
                <Icon as={LuChevronsUpDown} boxSize={3} />
              </Flex>
            </Tooltip>
            <Tooltip content="Collapse all" positioning={{ placement: "top" }}>
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
                onClick={handleCollapseAll}
              >
                <Icon as={LuChevronsDownUp} boxSize={3} />
              </Flex>
            </Tooltip>
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
                    isCollapsed={collapsedIds.has(node.span.spanId)}
                    hasChildren={node.children.length > 0}
                    isDimmed={
                      selectedSpanId !== null &&
                      node.span.spanId !== selectedSpanId
                    }
                    onToggleCollapse={() =>
                      handleToggleCollapse(node.span.spanId)
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
          bg="border.subtle"
          opacity={0.6}
          transition="all 0.15s ease"
        />
      </Box>

      {/* Timeline panel */}
      <Flex
        direction="column"
        flex={1}
        minWidth={0}
        height="full"
        overflow="hidden"
      >
        {/* Time axis header */}
        <Flex
          align="center"
          position="relative"
          height="24px"
          flexShrink={0}
          paddingX={2}
          borderBottomWidth="1px"
          borderColor="border.subtle"
          bg="bg.subtle/30"
        >
          {timeMarkers.map((ms, idx) => {
            const pct = rootDuration > 0 ? (ms / rootDuration) * 100 : 0;
            const isLast = idx === timeMarkers.length - 1;
            const isFirst = idx === 0;
            return (
              <Text
                key={idx}
                textStyle="xs"
                color="fg.subtle"
                position="absolute"
                left={`${pct}%`}
                transform={
                  isLast
                    ? "translateX(-100%)"
                    : isFirst
                      ? undefined
                      : "translateX(-50%)"
                }
                whiteSpace="nowrap"
                userSelect="none"
                lineHeight={1}
              >
                {formatDuration(ms)}
              </Text>
            );
          })}
        </Flex>

        {/* Timeline rows — driven by the tree's scroll position via transform.
            No native scrollbar here; wheel events delegate to the tree. */}
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
            {/* Vertical grid lines */}
            <Box position="absolute" inset={0} pointerEvents="none" zIndex={0}>
              {timeMarkers.map((ms, idx) => {
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
