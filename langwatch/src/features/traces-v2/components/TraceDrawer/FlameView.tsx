import { Box, Flex, HStack, Icon, Text } from "@chakra-ui/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  LuArrowLeft,
  LuChevronRight,
} from "react-icons/lu";
import { Tooltip } from "~/components/ui/tooltip";
import type { SpanTreeNode } from "~/server/api/routers/tracesV2.schemas";
import { formatDuration, SPAN_TYPE_COLORS } from "../../utils/formatters";

interface FlameViewProps {
  spans: SpanTreeNode[];
  selectedSpanId: string | null;
  onSelectSpan: (spanId: string) => void;
  onClearSpan: () => void;
}

const ROW_HEIGHT = 24;
const ROW_GAP = 2;
const MIN_BLOCK_PX = 4;
const DEPTH_FADE_STEP = 0.06;
const MINIMAP_HEIGHT = 32;

interface FlameNode {
  span: SpanTreeNode;
  depth: number;
  children: FlameNode[];
  isOrphaned: boolean;
}

function buildTree(spans: SpanTreeNode[]): FlameNode[] {
  const byId = new Map<string, SpanTreeNode>();
  for (const span of spans) {
    byId.set(span.spanId, span);
  }

  const childrenMap = new Map<string | null, SpanTreeNode[]>();
  for (const span of spans) {
    const parentExists = span.parentSpanId ? byId.has(span.parentSpanId) : true;
    const key = parentExists ? span.parentSpanId : null;
    const list = childrenMap.get(key) ?? [];
    list.push(span);
    childrenMap.set(key, list);
  }

  function build(parentId: string | null, depth: number): FlameNode[] {
    const children = childrenMap.get(parentId) ?? [];
    const sorted = [...children].sort((a, b) => a.startTimeMs - b.startTimeMs);
    return sorted.map((span) => ({
      span,
      depth,
      isOrphaned: span.parentSpanId !== null && !byId.has(span.parentSpanId),
      children: build(span.spanId, depth + 1),
    }));
  }

  return build(null, 0);
}

function flattenAll(roots: FlameNode[]): FlameNode[] {
  const result: FlameNode[] = [];
  function walk(node: FlameNode) {
    result.push(node);
    for (const child of node.children) walk(child);
  }
  for (const root of roots) walk(root);
  return result;
}

function getSubtreeSpanIds(spanId: string, allNodes: FlameNode[]): Set<string> {
  const nodeMap = new Map<string, FlameNode>();
  for (const n of allNodes) nodeMap.set(n.span.spanId, n);
  const ids = new Set<string>();
  function collect(node: FlameNode) {
    ids.add(node.span.spanId);
    for (const child of node.children) collect(child);
  }
  const root = nodeMap.get(spanId);
  if (root) collect(root);
  return ids;
}

function getAncestorChain(spanId: string, spans: SpanTreeNode[]): SpanTreeNode[] {
  const byId = new Map<string, SpanTreeNode>();
  for (const s of spans) byId.set(s.spanId, s);
  const chain: SpanTreeNode[] = [];
  let current = byId.get(spanId);
  while (current) {
    chain.unshift(current);
    current = current.parentSpanId ? byId.get(current.parentSpanId) : undefined;
  }
  return chain;
}

export function FlameView({
  spans,
  selectedSpanId,
  onSelectSpan,
  onClearSpan,
}: FlameViewProps) {
  const [zoomStack, setZoomStack] = useState<string[]>([]);
  const [focusedSpanId, setFocusedSpanId] = useState<string | null>(null);
  const [hoveredSpanId, setHoveredSpanId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const currentZoomSpanId =
    zoomStack.length > 0 ? zoomStack[zoomStack.length - 1]! : null;

  const tree = useMemo(() => buildTree(spans), [spans]);
  const allNodes = useMemo(() => flattenAll(tree), [tree]);

  const fullRange = useMemo(() => {
    if (spans.length === 0) return { start: 0, end: 0 };
    return {
      start: Math.min(...spans.map((s) => s.startTimeMs)),
      end: Math.max(...spans.map((s) => s.endTimeMs)),
    };
  }, [spans]);

  const zoomRange = useMemo(() => {
    if (!currentZoomSpanId) return fullRange;
    const span = spans.find((s) => s.spanId === currentZoomSpanId);
    if (!span) return fullRange;
    return { start: span.startTimeMs, end: span.endTimeMs };
  }, [currentZoomSpanId, spans, fullRange]);

  const visibleSpanIds = useMemo(() => {
    if (!currentZoomSpanId) return null;
    return getSubtreeSpanIds(currentZoomSpanId, allNodes);
  }, [currentZoomSpanId, allNodes]);

  const breadcrumbs = useMemo(() => {
    if (!currentZoomSpanId) return [];
    return getAncestorChain(currentZoomSpanId, spans);
  }, [currentZoomSpanId, spans]);

  const baseDepth = useMemo(() => {
    if (!currentZoomSpanId) return 0;
    const node = allNodes.find((n) => n.span.spanId === currentZoomSpanId);
    return node ? node.depth : 0;
  }, [currentZoomSpanId, allNodes]);

  const maxDepth = useMemo(() => {
    let max = 0;
    for (const node of allNodes) {
      if (!visibleSpanIds || visibleSpanIds.has(node.span.spanId)) {
        max = Math.max(max, node.depth);
      }
    }
    return max;
  }, [allNodes, visibleSpanIds]);

  const rangeDuration = zoomRange.end - zoomRange.start;

  const timeMarkers = useMemo(() => {
    if (rangeDuration <= 0) return [];
    const count = 5;
    return Array.from({ length: count + 1 }, (_, i) => ({
      offset: i / count,
      label: formatDuration((i / count) * rangeDuration),
    }));
  }, [rangeDuration]);

  // Visible blocks: filter and optionally group siblings
  const visibleBlocks = useMemo(() => {
    const filtered = allNodes.filter(
      (n) => !visibleSpanIds || visibleSpanIds.has(n.span.spanId),
    );
    return filtered;
  }, [allNodes, visibleSpanIds]);

  // Count hidden spans (too narrow to render at current zoom)
  const hiddenSpanCount = useMemo(() => {
    if (spans.length <= 200) return 0;
    const rd = zoomRange.end - zoomRange.start;
    if (rd <= 0) return 0;
    let count = 0;
    for (const node of visibleBlocks) {
      const spanDuration = node.span.endTimeMs - node.span.startTimeMs;
      const widthPct = (spanDuration / rd) * 100;
      if (widthPct < 0.1) count++;
    }
    return count;
  }, [visibleBlocks, zoomRange, spans.length]);

  const handleBlockClick = useCallback(
    (spanId: string) => {
      if (currentZoomSpanId === spanId) {
        onSelectSpan(spanId);
      } else {
        setZoomStack((prev) => [...prev, spanId]);
      }
    },
    [currentZoomSpanId, onSelectSpan],
  );

  const handleBlockDoubleClick = useCallback(
    (spanId: string) => {
      if (currentZoomSpanId !== spanId) {
        setZoomStack((prev) => [...prev, spanId]);
      }
      onSelectSpan(spanId);
    },
    [currentZoomSpanId, onSelectSpan],
  );

  const handleZoomOut = useCallback(() => {
    setZoomStack((prev) => prev.slice(0, -1));
  }, []);

  const handleBreadcrumbClick = useCallback(
    (spanId: string) => {
      const idx = zoomStack.indexOf(spanId);
      if (idx >= 0) {
        setZoomStack(zoomStack.slice(0, idx + 1));
      } else {
        setZoomStack([]);
      }
    },
    [zoomStack],
  );

  const handleMinimapNavigate = useCallback((spanId: string) => {
    setZoomStack([spanId]);
  }, []);

  const handleMinimapReset = useCallback(() => {
    setZoomStack([]);
  }, []);

  // Keyboard navigation
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      )
        return;
      if (!el.contains(target) && target !== el) return;

      switch (e.key) {
        case "Enter": {
          if (focusedSpanId) {
            e.preventDefault();
            handleBlockClick(focusedSpanId);
          }
          break;
        }
        case " ": {
          if (focusedSpanId) {
            e.preventDefault();
            onSelectSpan(focusedSpanId);
          }
          break;
        }
        case "Backspace": {
          e.preventDefault();
          handleZoomOut();
          break;
        }
        case "Escape": {
          e.preventDefault();
          if (zoomStack.length > 0) {
            handleZoomOut();
          } else if (selectedSpanId) {
            onClearSpan();
          }
          break;
        }
        case "ArrowUp": {
          e.preventDefault();
          if (focusedSpanId) {
            const node = allNodes.find((n) => n.span.spanId === focusedSpanId);
            if (node?.span.parentSpanId) {
              setFocusedSpanId(node.span.parentSpanId);
            }
          }
          break;
        }
        case "ArrowDown": {
          e.preventDefault();
          if (focusedSpanId) {
            const node = allNodes.find((n) => n.span.spanId === focusedSpanId);
            if (node && node.children.length > 0) {
              setFocusedSpanId(node.children[0]!.span.spanId);
            }
          }
          break;
        }
        case "ArrowLeft": {
          e.preventDefault();
          navigateSibling(-1);
          break;
        }
        case "ArrowRight": {
          e.preventDefault();
          navigateSibling(1);
          break;
        }
      }
    };

    function navigateSibling(direction: number) {
      if (!focusedSpanId) {
        if (visibleBlocks.length > 0) {
          setFocusedSpanId(visibleBlocks[0]!.span.spanId);
        }
        return;
      }
      const node = allNodes.find((n) => n.span.spanId === focusedSpanId);
      if (!node) return;
      // Find siblings (same parent, same depth)
      const siblings = allNodes.filter(
        (n) =>
          n.span.parentSpanId === node.span.parentSpanId &&
          n.depth === node.depth &&
          (!visibleSpanIds || visibleSpanIds.has(n.span.spanId)),
      );
      const idx = siblings.findIndex((n) => n.span.spanId === focusedSpanId);
      const nextIdx = idx + direction;
      if (nextIdx >= 0 && nextIdx < siblings.length) {
        setFocusedSpanId(siblings[nextIdx]!.span.spanId);
      }
    }

    el.addEventListener("keydown", handleKeyDown);
    return () => el.removeEventListener("keydown", handleKeyDown);
  }, [
    focusedSpanId,
    allNodes,
    visibleBlocks,
    visibleSpanIds,
    zoomStack,
    selectedSpanId,
    handleBlockClick,
    handleZoomOut,
    onSelectSpan,
    onClearSpan,
  ]);

  // For large traces, disable the dim-all-others hover effect (perf)
  const dimOnHover = spans.length <= 100;

  const visibleDepthRange = maxDepth - baseDepth + 1;
  const totalHeight =
    ROW_HEIGHT * visibleDepthRange + ROW_GAP * (visibleDepthRange - 1);

  if (spans.length === 0) {
    return (
      <Flex align="center" justify="center" height="full">
        <Text textStyle="xs" color="fg.subtle">
          No span data available
        </Text>
      </Flex>
    );
  }

  return (
    <Flex
      ref={containerRef}
      direction="column"
      height="full"
      overflow="hidden"
      tabIndex={0}
      outline="none"
      _focusVisible={{ outline: "none" }}
    >
      {/* Breadcrumbs */}
      {zoomStack.length > 0 && (
        <Flex
          align="center"
          gap={1}
          paddingX={3}
          paddingY={1}
          flexShrink={0}
          borderBottomWidth="1px"
          borderColor="border.subtle"
          bg="bg.subtle/30"
          flexWrap="wrap"
        >
          <Tooltip content="Zoom out" positioning={{ placement: "top" }}>
            <Flex
              as="button"
              align="center"
              justify="center"
              width="20px"
              height="20px"
              borderRadius="sm"
              cursor="pointer"
              color="fg.muted"
              _hover={{ bg: "bg.muted", color: "fg" }}
              onClick={handleZoomOut}
            >
              <Icon as={LuArrowLeft} boxSize={3} />
            </Flex>
          </Tooltip>

          <Flex
            as="button"
            cursor="pointer"
            onClick={() => setZoomStack([])}
            _hover={{ color: "fg" }}
          >
            <Text textStyle="xs" color="fg.muted">
              root
            </Text>
          </Flex>

          {breadcrumbs.map((span, i) => {
            const isLast = i === breadcrumbs.length - 1;
            return (
              <HStack key={span.spanId} gap={0}>
                <Icon as={LuChevronRight} boxSize={3} color="fg.subtle" />
                <Flex
                  as="button"
                  cursor={isLast ? "default" : "pointer"}
                  onClick={() => !isLast && handleBreadcrumbClick(span.spanId)}
                  paddingX={1}
                  paddingY={0.5}
                  borderRadius="sm"
                  _hover={isLast ? undefined : { bg: "bg.muted" }}
                >
                  <Text
                    textStyle="xs"
                    color={isLast ? "fg" : "fg.muted"}
                    fontWeight={isLast ? "medium" : "normal"}
                    fontFamily="mono"
                  >
                    {span.name}
                  </Text>
                </Flex>
              </HStack>
            );
          })}
        </Flex>
      )}

      {/* Minimap (shown when zoomed) */}
      {zoomStack.length > 0 && (
        <Minimap
          allNodes={allNodes}
          zoomRange={zoomRange}
          fullRange={fullRange}
          currentZoomSpanId={currentZoomSpanId}
          onNavigate={handleMinimapNavigate}
          onReset={handleMinimapReset}
        />
      )}

      {/* Time axis */}
      <Flex
        align="center"
        position="relative"
        height="20px"
        flexShrink={0}
        paddingX={3}
      >
        {timeMarkers.map((marker, i) => (
          <Text
            key={i}
            textStyle="xs"
            color="fg.subtle"
            position="absolute"
            left={`calc(12px + ${marker.offset} * (100% - 24px))`}
            transform={
              i === timeMarkers.length - 1
                ? "translateX(-100%)"
                : i === 0
                  ? undefined
                  : "translateX(-50%)"
            }
            whiteSpace="nowrap"
            userSelect="none"
          >
            {marker.label}
          </Text>
        ))}
      </Flex>

      {/* Flame blocks */}
      <Box
        flex={1}
        overflow="auto"
        position="relative"
        paddingX={3}
        paddingBottom={2}
        css={{
          "&::-webkit-scrollbar": { width: "4px", height: "4px" },
          "&::-webkit-scrollbar-thumb": {
            borderRadius: "4px",
            background: "var(--chakra-colors-border-muted)",
          },
          "&::-webkit-scrollbar-track": { background: "transparent" },
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) onClearSpan();
        }}
      >
        <Box
          position="relative"
          minHeight={`${Math.max(totalHeight, 32)}px`}
        >
          {visibleBlocks.map((node) => {
            const { span, depth } = node;
            const spanDuration = span.endTimeMs - span.startTimeMs;
            const adjustedDepth = depth - baseDepth;
            const top = adjustedDepth * (ROW_HEIGHT + ROW_GAP);

            const leftPct =
              rangeDuration > 0
                ? ((span.startTimeMs - zoomRange.start) / rangeDuration) * 100
                : 0;
            const widthPct =
              rangeDuration > 0
                ? (spanDuration / rangeDuration) * 100
                : 100;

            // Skip blocks that are too narrow at current zoom (perf)
            if (widthPct < 0.1 && spans.length > 200) return null;

            const color =
              (SPAN_TYPE_COLORS[span.type ?? "span"] as string) ?? "gray.solid";
            const depthOpacity = Math.max(
              0.45,
              1 - adjustedDepth * DEPTH_FADE_STEP,
            );
            const isError = span.status === "error";
            const isSelected = span.spanId === selectedSpanId;
            const isHovered = span.spanId === hoveredSpanId;
            const isFocused = span.spanId === focusedSpanId;
            const isZeroDuration = spanDuration === 0;

            const tooltipLines = [
              span.name,
              `Duration: ${isZeroDuration ? "<1ms" : formatDuration(spanDuration)}`,
              span.model ? `Model: ${span.model}` : null,
              node.isOrphaned ? "⚠ Parent not in trace" : null,
            ].filter(Boolean);

            return (
              <Tooltip
                key={span.spanId}
                content={tooltipLines.join("\n")}
                positioning={{ placement: "top" }}
              >
                <Box
                  position="absolute"
                  top={`${top}px`}
                  left={`${leftPct}%`}
                  width={`${widthPct}%`}
                  minWidth={`${MIN_BLOCK_PX}px`}
                  height={`${ROW_HEIGHT}px`}
                  bg={color}
                  opacity={
                    isSelected || isHovered || isFocused
                      ? 1
                      : dimOnHover && hoveredSpanId
                        ? depthOpacity * 0.5
                        : depthOpacity
                  }
                  borderWidth={
                    isError
                      ? "1.5px"
                      : isSelected || isFocused
                        ? "1.5px"
                        : "0.5px"
                  }
                  borderColor={
                    isError
                      ? "red.solid"
                      : isSelected || isFocused
                        ? "border.emphasized"
                        : "blackAlpha.200"
                  }
                  borderStyle={node.isOrphaned ? "dashed" : "solid"}
                  borderRadius="sm"
                  cursor="pointer"
                  overflow="hidden"
                  onClick={(e) => {
                    e.stopPropagation();
                    setFocusedSpanId(span.spanId);
                    handleBlockClick(span.spanId);
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    handleBlockDoubleClick(span.spanId);
                  }}
                  onMouseEnter={() => setHoveredSpanId(span.spanId)}
                  onMouseLeave={() => setHoveredSpanId(null)}
                  transition={dimOnHover ? "opacity 0.1s ease, border-color 0.1s ease" : "border-color 0.1s ease"}
                  display="flex"
                  alignItems="center"
                  paddingX={1}
                  boxShadow={
                    isSelected
                      ? "sm"
                      : isHovered
                        ? "xs"
                        : undefined
                  }
                >
                  <Text
                    textStyle="xs"
                    color="white"
                    truncate
                    lineHeight={1}
                    userSelect="none"
                    textShadow="0 1px 1px rgba(0,0,0,0.25)"
                  >
                    <BlockLabel
                      name={span.name}
                      duration={spanDuration}
                      model={span.type === "llm" ? span.model : null}
                      widthPct={widthPct}
                    />
                  </Text>
                </Box>
              </Tooltip>
            );
          })}
        </Box>

        {/* Hidden spans indicator */}
        {hiddenSpanCount > 0 && (
          <Flex justify="center" paddingY={1}>
            <Text textStyle="xs" color="fg.subtle">
              {hiddenSpanCount} span{hiddenSpanCount !== 1 ? "s" : ""} too small
              to display — zoom in to see
            </Text>
          </Flex>
        )}
      </Box>
    </Flex>
  );
}

function Minimap({
  allNodes,
  zoomRange,
  fullRange,
  currentZoomSpanId,
  onNavigate,
  onReset,
}: {
  allNodes: FlameNode[];
  zoomRange: { start: number; end: number };
  fullRange: { start: number; end: number };
  currentZoomSpanId: string | null;
  onNavigate: (spanId: string) => void;
  onReset: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const fullDuration = fullRange.end - fullRange.start;

  const maxDepth = useMemo(
    () => (allNodes.length > 0 ? Math.max(...allNodes.map((n) => n.depth)) : 0),
    [allNodes],
  );

  const findSpanAtX = useCallback(
    (clientX: number): FlameNode | null => {
      const rect = ref.current?.getBoundingClientRect();
      if (!rect || fullDuration <= 0) return null;
      const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const clickTime = fullRange.start + x * fullDuration;

      let best: FlameNode | null = null;
      let bestScore = Infinity;
      for (const node of allNodes) {
        // Prefer shallow spans for meaningful navigation
        if (node.depth > 2) continue;
        const mid = (node.span.startTimeMs + node.span.endTimeMs) / 2;
        const dist = Math.abs(mid - clickTime);
        const score = dist + node.depth * fullDuration;
        if (score < bestScore) {
          bestScore = score;
          best = node;
        }
      }
      return best;
    },
    [allNodes, fullRange.start, fullDuration],
  );

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (isDragging.current) return;
      const span = findSpanAtX(e.clientX);
      if (span) {
        onNavigate(span.span.spanId);
      } else {
        onReset();
      }
    },
    [findSpanAtX, onNavigate, onReset],
  );

  const handleViewportMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      isDragging.current = true;
      document.body.style.cursor = "grabbing";
      document.body.style.userSelect = "none";

      const handleMove = (moveEvent: MouseEvent) => {
        const span = findSpanAtX(moveEvent.clientX);
        if (span && span.span.spanId !== currentZoomSpanId) {
          onNavigate(span.span.spanId);
        }
      };

      const handleUp = () => {
        isDragging.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        window.removeEventListener("mousemove", handleMove);
        window.removeEventListener("mouseup", handleUp);
      };

      window.addEventListener("mousemove", handleMove);
      window.addEventListener("mouseup", handleUp);
    },
    [findSpanAtX, currentZoomSpanId, onNavigate],
  );

  if (fullDuration <= 0) return null;

  const rowH = Math.max(2, (MINIMAP_HEIGHT - 4) / (maxDepth + 1));
  const vpLeft = ((zoomRange.start - fullRange.start) / fullDuration) * 100;
  const vpWidth = Math.max(
    1,
    ((zoomRange.end - zoomRange.start) / fullDuration) * 100,
  );

  return (
    <Box
      ref={ref}
      position="relative"
      height={`${MINIMAP_HEIGHT}px`}
      marginX={3}
      marginTop={1}
      borderRadius="sm"
      bg="bg.subtle/50"
      overflow="hidden"
      cursor="pointer"
      onClick={handleClick}
      borderWidth="1px"
      borderColor="border.subtle"
      flexShrink={0}
    >
      {/* All spans as tiny blocks */}
      {allNodes.map((node) => {
        const left =
          ((node.span.startTimeMs - fullRange.start) / fullDuration) * 100;
        const width = Math.max(
          0.3,
          ((node.span.endTimeMs - node.span.startTimeMs) / fullDuration) * 100,
        );
        const top = 2 + node.depth * rowH;
        const color =
          (SPAN_TYPE_COLORS[node.span.type ?? "span"] as string) ??
          "gray.solid";
        return (
          <Box
            key={node.span.spanId}
            position="absolute"
            left={`${left}%`}
            width={`${width}%`}
            top={`${top}px`}
            height={`${Math.max(1, rowH - 1)}px`}
            bg={color}
            opacity={0.6}
            minWidth="1px"
            borderRadius="xs"
          />
        );
      })}

      {/* Dim outside viewport */}
      <Box
        position="absolute"
        left={0}
        width={`${vpLeft}%`}
        top={0}
        bottom={0}
        bg="blackAlpha.300"
      />
      <Box
        position="absolute"
        right={0}
        width={`${Math.max(0, 100 - vpLeft - vpWidth)}%`}
        top={0}
        bottom={0}
        bg="blackAlpha.300"
      />

      {/* Viewport indicator */}
      <Box
        position="absolute"
        left={`${vpLeft}%`}
        width={`${vpWidth}%`}
        top={0}
        bottom={0}
        borderWidth="1.5px"
        borderColor="fg.muted"
        bg="transparent"
        borderRadius="sm"
        cursor="grab"
        onMouseDown={handleViewportMouseDown}
        _active={{ cursor: "grabbing" }}
      />
    </Box>
  );
}

function BlockLabel({
  name,
  duration,
  model,
  widthPct,
}: {
  name: string;
  duration: number;
  model: string | null;
  widthPct: number;
}) {
  if (widthPct < 2) return null;
  if (widthPct < 5) return <>{name.slice(0, 8)}</>;
  if (widthPct >= 15 && model) {
    return (
      <>
        {name} ({formatDuration(duration)}) · {model.split("/").pop()}
      </>
    );
  }
  if (widthPct >= 8) {
    return (
      <>
        {name} ({formatDuration(duration)})
      </>
    );
  }
  return <>{name}</>;
}
