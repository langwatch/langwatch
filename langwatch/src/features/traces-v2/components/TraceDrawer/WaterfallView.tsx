import { Box, Flex, HStack, Icon, Text } from "@chakra-ui/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  LuChevronDown,
  LuChevronRight,
  LuChevronsDownUp,
  LuChevronsUpDown,
  LuList,
  LuTriangleAlert,
  LuUnlink,
} from "react-icons/lu";
import { Tooltip } from "~/components/ui/tooltip";
import type { SpanTreeNode } from "~/server/api/routers/tracesV2.schemas";
import {
  abbreviateModel,
  formatDuration,
  SPAN_TYPE_COLORS,
} from "../../utils/formatters";

interface WaterfallViewProps {
  spans: SpanTreeNode[];
  selectedSpanId: string | null;
  onSelectSpan: (spanId: string) => void;
  onClearSpan: () => void;
  onSwitchToSpanList?: (nameFilter: string, typeFilter: string) => void;
}

interface WaterfallTreeNode {
  span: SpanTreeNode;
  children: WaterfallTreeNode[];
  depth: number;
  isOrphaned: boolean;
}

interface SiblingGroup {
  kind: "group";
  name: string;
  type: string;
  count: number;
  spans: SpanTreeNode[];
  avgDuration: number;
  minDuration: number;
  maxDuration: number;
  errorCount: number;
  minStart: number;
  maxEnd: number;
  depth: number;
  parentSpanId: string | null;
}

type FlatRow =
  | { kind: "span"; node: WaterfallTreeNode }
  | SiblingGroup;

const ROW_HEIGHT = 28;
const LLM_ROW_HEIGHT = 40;
const GROUP_ROW_HEIGHT = 36;
const INDENT_PX = 20;
const MIN_TREE_WIDTH = 200;
const DEFAULT_TREE_PCT = 0.38;
const MIN_BAR_PX = 3;
const BAR_HEIGHT = 14;
const SIBLING_GROUP_THRESHOLD = 5;

const SPAN_TYPE_ICONS: Record<string, string> = {
  llm: "◈",
  tool: "⚙",
  agent: "◎",
  rag: "⊛",
  guardrail: "◉",
  evaluation: "◇",
  chain: "○",
  span: "○",
  module: "○",
  workflow: "○",
};

function buildTree(spans: SpanTreeNode[]): WaterfallTreeNode[] {
  const byId = new Map<string, SpanTreeNode>();
  for (const span of spans) {
    byId.set(span.spanId, span);
  }

  const childrenMap = new Map<string | null, SpanTreeNode[]>();
  for (const span of spans) {
    // Determine if this span's parent exists in the trace
    const parentExists = span.parentSpanId ? byId.has(span.parentSpanId) : true;
    const key = parentExists ? span.parentSpanId : null;
    const list = childrenMap.get(key) ?? [];
    list.push(span);
    childrenMap.set(key, list);
  }

  function buildNodes(
    parentId: string | null,
    depth: number,
  ): WaterfallTreeNode[] {
    const children = childrenMap.get(parentId) ?? [];
    const sorted = [...children].sort(
      (a, b) => a.startTimeMs - b.startTimeMs,
    );
    return sorted.map((span) => {
      const isOrphaned =
        span.parentSpanId !== null && !byId.has(span.parentSpanId);
      return {
        span,
        children: buildNodes(span.spanId, depth + 1),
        depth,
        isOrphaned,
      };
    });
  }

  return buildNodes(null, 0);
}

function groupSiblings(children: WaterfallTreeNode[]): (WaterfallTreeNode | SiblingGroup)[] {
  if (children.length <= SIBLING_GROUP_THRESHOLD) return children;

  const nameGroups = new Map<string, WaterfallTreeNode[]>();
  const order: string[] = [];
  for (const child of children) {
    const key = `${child.span.name}::${child.span.type ?? "span"}`;
    if (!nameGroups.has(key)) {
      nameGroups.set(key, []);
      order.push(key);
    }
    nameGroups.get(key)!.push(child);
  }

  const result: (WaterfallTreeNode | SiblingGroup)[] = [];
  for (const key of order) {
    const group = nameGroups.get(key)!;
    if (group.length > SIBLING_GROUP_THRESHOLD) {
      const spans = group.map((n) => n.span);
      const durations = spans.map((s) => s.durationMs);
      const errorCount = spans.filter((s) => s.status === "error").length;
      result.push({
        kind: "group",
        name: group[0]!.span.name,
        type: group[0]!.span.type ?? "span",
        count: group.length,
        spans,
        avgDuration:
          durations.reduce((a, b) => a + b, 0) / durations.length,
        minDuration: Math.min(...durations),
        maxDuration: Math.max(...durations),
        errorCount,
        minStart: Math.min(...spans.map((s) => s.startTimeMs)),
        maxEnd: Math.max(...spans.map((s) => s.endTimeMs)),
        depth: group[0]!.depth,
        parentSpanId: group[0]!.span.parentSpanId,
      });
    } else {
      result.push(...group);
    }
  }
  return result;
}

function flattenTree(
  nodes: WaterfallTreeNode[],
  collapsedIds: Set<string>,
  expandedGroups: Set<string>,
): FlatRow[] {
  const result: FlatRow[] = [];

  function walk(nodeList: WaterfallTreeNode[]) {
    // Group siblings at this level
    const items = groupSiblings(nodeList);

    for (const item of items) {
      if ("kind" in item && item.kind === "group") {
        const groupKey = `${item.parentSpanId}::${item.name}`;
        result.push(item);
        if (expandedGroups.has(groupKey)) {
          for (const span of item.spans) {
            const fakeNode: WaterfallTreeNode = {
              span,
              children: [],
              depth: item.depth,
              isOrphaned: false,
            };
            result.push({ kind: "span", node: fakeNode });
          }
        }
      } else {
        const node = item as WaterfallTreeNode;
        result.push({ kind: "span", node });
        if (!collapsedIds.has(node.span.spanId) && node.children.length > 0) {
          walk(node.children);
        }
      }
    }
  }

  walk(nodes);
  return result;
}

function getTraceRange(spans: SpanTreeNode[]): {
  rootStart: number;
  rootEnd: number;
  rootDuration: number;
} {
  if (spans.length === 0) {
    return { rootStart: 0, rootEnd: 0, rootDuration: 0 };
  }
  const rootStart = Math.min(...spans.map((s) => s.startTimeMs));
  const rootEnd = Math.max(...spans.map((s) => s.endTimeMs));
  return {
    rootStart,
    rootEnd,
    rootDuration: rootEnd - rootStart,
  };
}

function getTimeMarkers(duration: number): number[] {
  if (duration <= 0) return [0];
  const count = 5;
  return Array.from({ length: count + 1 }, (_, i) => (i / count) * duration);
}

export function WaterfallView({
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
  const timelineScrollRef = useRef<HTMLDivElement>(null);

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
  const rootCount = useMemo(
    () => tree.length,
    [tree],
  );

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

  // Synchronized scrolling: tree drives timeline
  const syncingScroll = useRef(false);
  const handleTreeScroll = useCallback(() => {
    if (syncingScroll.current) return;
    syncingScroll.current = true;
    if (treeScrollRef.current && timelineScrollRef.current) {
      timelineScrollRef.current.scrollTop = treeScrollRef.current.scrollTop;
    }
    requestAnimationFrame(() => {
      syncingScroll.current = false;
    });
  }, []);

  const handleTimelineScroll = useCallback(() => {
    if (syncingScroll.current) return;
    syncingScroll.current = true;
    if (treeScrollRef.current && timelineScrollRef.current) {
      treeScrollRef.current.scrollTop = timelineScrollRef.current.scrollTop;
    }
    requestAnimationFrame(() => {
      syncingScroll.current = false;
    });
  }, []);

  // Resizable divider
  const handleDividerStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDraggingDivider.current = true;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [],
  );

  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      if (!isDraggingDivider.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const pct = Math.min(0.7, Math.max(MIN_TREE_WIDTH / rect.width, x / rect.width));
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
          <Box position="relative" height={`${virtualizer.getTotalSize()}px`} width="full">
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
                        handleToggleGroup(
                          `${row.parentSpanId}::${row.name}`,
                        )
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
      <Flex direction="column" flex={1} minWidth={0} height="full" overflow="hidden">
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
            const pct =
              rootDuration > 0 ? (ms / rootDuration) * 100 : 0;
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

        {/* Timeline rows (virtualized, synced with tree) */}
        <Box
          ref={timelineScrollRef}
          flex={1}
          overflowY="auto"
          overflowX="hidden"
          position="relative"
          onScroll={handleTimelineScroll}
          css={{
            "&::-webkit-scrollbar": { width: "4px" },
            "&::-webkit-scrollbar-thumb": {
              borderRadius: "4px",
              background: "var(--chakra-colors-border-muted)",
            },
            "&::-webkit-scrollbar-track": { background: "transparent" },
          }}
        >
          <Box position="relative" height={`${virtualizer.getTotalSize()}px`} width="full">
            {/* Vertical grid lines */}
            <Box position="absolute" inset={0} pointerEvents="none" zIndex={0}>
              {timeMarkers.map((ms, idx) => {
                const pct =
                  rootDuration > 0 ? (ms / rootDuration) * 100 : 0;
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
              const i = virtualRow.index;

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
}

function TreeRow({
  node,
  isSelected,
  isHovered,
  isCollapsed,
  hasChildren,
  isDimmed,
  onToggleCollapse,
  onSelect,
  onHoverStart,
  onHoverEnd,
}: {
  node: WaterfallTreeNode;
  isSelected: boolean;
  isHovered: boolean;
  isCollapsed: boolean;
  hasChildren: boolean;
  isDimmed: boolean;
  onToggleCollapse: () => void;
  onSelect: () => void;
  onHoverStart: () => void;
  onHoverEnd: () => void;
}) {
  const { span, depth, isOrphaned } = node;
  const isError = span.status === "error";
  const color = (SPAN_TYPE_COLORS[span.type ?? "span"] as string) ?? "gray.solid";
  const isLlm = span.type === "llm" && span.model != null;
  const rowH = isLlm ? LLM_ROW_HEIGHT : ROW_HEIGHT;
  const icon = SPAN_TYPE_ICONS[span.type ?? "span"] ?? "○";
  const duration = span.durationMs;
  const isZeroDuration = duration === 0;

  const tooltipLines = [
    span.name,
    `Type: ${(span.type ?? "span").toUpperCase()}`,
    `Duration: ${isZeroDuration ? "<1ms" : formatDuration(duration)}`,
    span.model ? `Model: ${span.model}` : null,
    isOrphaned ? "⚠ Parent not in trace" : null,
  ].filter(Boolean);

  return (
    <Tooltip
      content={tooltipLines.join("\n")}
      positioning={{ placement: "right" }}
    >
      <Box>
        <HStack
          height={`${rowH}px`}
          gap={0}
          paddingLeft={`${depth * INDENT_PX + 4}px`}
          paddingRight={2}
          bg={isSelected ? "blue.subtle" : isHovered ? "bg.muted" : undefined}
          opacity={isDimmed && !isSelected && !isHovered ? 0.5 : 1}
          _hover={{ bg: isSelected ? "blue.subtle" : "bg.muted" }}
          cursor="pointer"
          onClick={onSelect}
          onMouseEnter={onHoverStart}
          onMouseLeave={onHoverEnd}
          userSelect="none"
          flexShrink={0}
          transition="all 0.1s ease"
          borderLeftWidth={isSelected ? "2px" : "0px"}
          borderLeftColor={isSelected ? "blue.solid" : "transparent"}
        >
          {/* Chevron */}
          <Flex
            width="16px"
            height="16px"
            align="center"
            justify="center"
            flexShrink={0}
            onClick={(e) => {
              if (hasChildren) {
                e.stopPropagation();
                onToggleCollapse();
              }
            }}
            opacity={hasChildren ? 1 : 0}
            cursor={hasChildren ? "pointer" : "default"}
            borderRadius="xs"
            _hover={hasChildren ? { bg: "bg.emphasized" } : undefined}
          >
            <Icon
              as={isCollapsed ? LuChevronRight : LuChevronDown}
              boxSize={3}
              color="fg.muted"
            />
          </Flex>

          {/* Type icon */}
          <Flex
            width="18px"
            height="18px"
            align="center"
            justify="center"
            flexShrink={0}
            marginRight={1}
          >
            <Text
              textStyle="xs"
              color={isError ? "red.fg" : color}
              lineHeight={1}
              userSelect="none"
            >
              {icon}
            </Text>
          </Flex>

          {/* Orphaned indicator */}
          {isOrphaned && (
            <Tooltip content="Parent not in trace" positioning={{ placement: "top" }}>
              <Flex flexShrink={0} marginRight={1}>
                <Icon as={LuUnlink} boxSize={3} color="yellow.fg" />
              </Flex>
            </Tooltip>
          )}

          {/* Span name + metadata */}
          <Flex
            direction="column"
            flex={1}
            minWidth={0}
            gap={0}
            justify="center"
          >
            <HStack gap={1} minWidth={0}>
              <Text
                textStyle="xs"
                color={isError ? "red.fg" : "fg"}
                fontFamily="mono"
                truncate
                flex={1}
                minWidth={0}
                lineHeight={1.2}
              >
                {span.name}
              </Text>
            </HStack>
            {isLlm && (
              <Text
                textStyle="xs"
                color="fg.subtle"
                fontFamily="mono"
                truncate
                lineHeight={1.2}
              >
                {abbreviateModel(span.model!)}
              </Text>
            )}
          </Flex>

          {/* Error indicator */}
          {isError && (
            <Icon
              as={LuTriangleAlert}
              boxSize={3}
              color="red.fg"
              flexShrink={0}
              marginLeft={1}
            />
          )}

          {/* Duration */}
          <Text
            textStyle="xs"
            color="fg.muted"
            fontFamily="mono"
            flexShrink={0}
            marginLeft={1}
            whiteSpace="nowrap"
          >
            {isZeroDuration ? "<1ms" : formatDuration(duration)}
          </Text>
        </HStack>
      </Box>
    </Tooltip>
  );
}

function GroupRow({
  group,
  isExpanded,
  onToggle,
  onSwitchToSpanList,
}: {
  group: SiblingGroup;
  isExpanded: boolean;
  onToggle: () => void;
  onSwitchToSpanList?: (nameFilter: string, typeFilter: string) => void;
}) {
  const color = (SPAN_TYPE_COLORS[group.type] as string) ?? "gray.solid";
  const icon = SPAN_TYPE_ICONS[group.type] ?? "○";

  return (
    <HStack
      height={`${GROUP_ROW_HEIGHT}px`}
      gap={0}
      paddingLeft={`${group.depth * INDENT_PX + 4}px`}
      paddingRight={2}
      bg="bg.subtle/40"
      _hover={{ bg: "bg.muted" }}
      cursor="pointer"
      onClick={onToggle}
      userSelect="none"
      flexShrink={0}
      borderLeftWidth="2px"
      borderLeftColor={color}
    >
      {/* Chevron */}
      <Flex width="16px" height="16px" align="center" justify="center" flexShrink={0}>
        <Icon
          as={isExpanded ? LuChevronDown : LuChevronRight}
          boxSize={3}
          color="fg.muted"
        />
      </Flex>

      {/* Type icon */}
      <Flex width="18px" height="18px" align="center" justify="center" flexShrink={0} marginRight={1}>
        <Text textStyle="xs" color={color} lineHeight={1}>
          {icon}
        </Text>
      </Flex>

      {/* Group info */}
      <Flex direction="column" flex={1} minWidth={0} gap={0} justify="center">
        <HStack gap={1.5} minWidth={0}>
          <Text textStyle="xs" fontFamily="mono" color="fg" truncate>
            {group.name}
          </Text>
          <Text
            textStyle="xs"
            color={color}
            fontWeight="semibold"
            flexShrink={0}
          >
            ×{group.count}
          </Text>
        </HStack>
        <HStack gap={1.5}>
          <Text textStyle="xs" color="fg.subtle" whiteSpace="nowrap">
            avg {formatDuration(group.avgDuration)}
          </Text>
          <Text textStyle="xs" color="fg.subtle" whiteSpace="nowrap">
            {formatDuration(group.minDuration)}–{formatDuration(group.maxDuration)}
          </Text>
          {group.errorCount > 0 && (
            <Text textStyle="xs" color="red.fg" whiteSpace="nowrap">
              {group.errorCount} error{group.errorCount > 1 ? "s" : ""}
            </Text>
          )}
        </HStack>
      </Flex>

      {/* View in Span List link */}
      {onSwitchToSpanList && (
        <Tooltip content="View in Span List" positioning={{ placement: "top" }}>
          <Flex
            as="button"
            align="center"
            justify="center"
            width="20px"
            height="20px"
            borderRadius="sm"
            color="fg.subtle"
            _hover={{ color: "blue.fg", bg: "blue.subtle" }}
            onClick={(e) => {
              e.stopPropagation();
              onSwitchToSpanList(group.name, group.type);
            }}
            flexShrink={0}
          >
            <Icon as={LuList} boxSize={3} />
          </Flex>
        </Tooltip>
      )}
    </HStack>
  );
}

function TimelineBar({
  span,
  rootStart,
  rootDuration,
  rowHeight,
  isSelected,
  isHovered,
  isDimmed,
  onSelect,
  onHoverStart,
  onHoverEnd,
}: {
  span: SpanTreeNode;
  rootStart: number;
  rootDuration: number;
  rowHeight: number;
  isSelected: boolean;
  isHovered: boolean;
  isDimmed: boolean;
  onSelect: () => void;
  onHoverStart: () => void;
  onHoverEnd: () => void;
}) {
  const isError = span.status === "error";
  const duration = span.durationMs;
  const color = (SPAN_TYPE_COLORS[span.type ?? "span"] as string) ?? "gray.solid";
  const isZeroDuration = duration === 0;

  const leftPct =
    rootDuration > 0
      ? ((span.startTimeMs - rootStart) / rootDuration) * 100
      : 0;
  const widthPct =
    rootDuration > 0 ? (duration / rootDuration) * 100 : 50;

  return (
    <Flex
      height={`${rowHeight}px`}
      align="center"
      position="relative"
      paddingX={2}
      cursor="pointer"
      onClick={onSelect}
      onMouseEnter={onHoverStart}
      onMouseLeave={onHoverEnd}
      opacity={isDimmed && !isSelected && !isHovered ? 0.4 : 1}
      transition="opacity 0.1s ease"
      bg={isSelected ? "blue.subtle" : isHovered ? "bg.muted" : undefined}
    >
      {isZeroDuration ? (
        /* Diamond marker for 0ms spans */
        <Box
          position="absolute"
          left={`calc(${leftPct}% - 4px)`}
          width="8px"
          height="8px"
          transform="rotate(45deg)"
          bg={isError ? "red.solid" : color}
          borderWidth={isSelected ? "1px" : "0px"}
          borderColor="border.emphasized"
          opacity={0.85}
        />
      ) : (
        <Box
          position="absolute"
          left={`${leftPct}%`}
          width={`${widthPct}%`}
          minWidth={`${MIN_BAR_PX}px`}
          height={`${BAR_HEIGHT}px`}
          borderRadius="sm"
          bg={color}
          opacity={isSelected ? 0.95 : isHovered ? 0.85 : 0.7}
          borderWidth={isError ? "1.5px" : isSelected ? "1px" : "0px"}
          borderColor={isError ? "red.solid" : isSelected ? "border.emphasized" : undefined}
          transition="opacity 0.1s ease"
          boxShadow={
            isSelected
              ? "0 1px 3px 0 rgba(0,0,0,0.1)"
              : isHovered
                ? "0 1px 2px 0 rgba(0,0,0,0.06)"
                : undefined
          }
        />
      )}
    </Flex>
  );
}

function GroupTimelineBar({
  group,
  rootStart,
  rootDuration,
}: {
  group: SiblingGroup;
  rootStart: number;
  rootDuration: number;
}) {
  const color = (SPAN_TYPE_COLORS[group.type] as string) ?? "gray.solid";
  const leftPct =
    rootDuration > 0
      ? ((group.minStart - rootStart) / rootDuration) * 100
      : 0;
  const widthPct =
    rootDuration > 0
      ? ((group.maxEnd - group.minStart) / rootDuration) * 100
      : 50;

  return (
    <Flex
      height={`${GROUP_ROW_HEIGHT}px`}
      align="center"
      position="relative"
      paddingX={2}
    >
      <Box
        position="absolute"
        left={`${leftPct}%`}
        width={`${widthPct}%`}
        minWidth={`${MIN_BAR_PX}px`}
        height={`${BAR_HEIGHT}px`}
        borderRadius="sm"
        bg={color}
        opacity={0.45}
        css={{
          backgroundImage: `repeating-linear-gradient(
            -45deg,
            transparent,
            transparent 3px,
            rgba(255,255,255,0.15) 3px,
            rgba(255,255,255,0.15) 6px
          )`,
        }}
      />
    </Flex>
  );
}
