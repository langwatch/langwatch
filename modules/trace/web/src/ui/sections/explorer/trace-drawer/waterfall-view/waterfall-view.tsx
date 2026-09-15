import { Box, chakra, Flex, HStack, Icon, Text } from "@chakra-ui/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type React from "react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LuChevronsDownUp, LuChevronsUpDown, LuSparkles } from "react-icons/lu";
import { Tooltip } from "@langwatch/design-system/tooltip";
import type { AnnotationByTrace } from "../../../use-annotations-by-trace-ids.ts";
import type { LangwatchSignalBucket, SpanTreeNode } from "@langwatch/trace-contract";
import { useAnchoredAnnotations } from "../../hooks/use-anchored-annotations.ts";
import { useSpanLangwatchSignals } from "../../hooks/use-span-langwatch-signals.ts";
import { useSpanLogs } from "../../hooks/use-span-logs.ts";
import { useTraceQueryArgs } from "../../hooks/use-trace-query-args.ts";
import { useSpanPulseStore } from "../../../../../behavior/span-pulse.store.ts";
import { formatDuration } from "../../../../../model/display-formatters.ts";
import { GroupRow } from "./group-row.tsx";
import { GroupTimelineBar, TimelineBar } from "./timeline-bar.tsx";
import { TreeRow } from "./tree-row.tsx";
import {
  buildTree,
  countDescendants,
  flattenTree,
  getTimeMarkers,
  getTraceRange,
  shouldShowTimeline,
  siblingGroupKey,
} from "./tree.ts";
import {
  DEFAULT_TREE_PCT,
  type FlatRow,
  GROUP_ROW_HEIGHT,
  INDENT_PX,
  isTwoLineSpan,
  LLM_ROW_HEIGHT,
  MIN_TREE_WIDTH,
  ROW_HEIGHT,
  type WaterfallViewProps,
} from "./types.ts";
import { useCorrectionMarks } from "./use-correction-marks.ts";
import { useScrollSelectedSpanIntoView } from "./use-scroll-selected-span-into-view.ts";
import { useWaterfallEditing } from "./use-waterfall-editing.ts";

// Shared fallback for spans without signals — a fresh `[]` per row per
// render would defeat TreeRow's memo by changing prop identity.
const EMPTY_SIGNALS: readonly LangwatchSignalBucket[] = [];
const EMPTY_COMMENTS: AnnotationByTrace[] = [];

/**
 * Collapses the deepest currently-expanded parent layer: walks depths from
 * the bottom up and, on the first layer with a still-expanded parent, adds
 * every one of that layer's parents to the collapsed set.
 */
function collapseDeepestExpandedLayer(
  parentsByDepth: Map<number, string[]>,
  collapsed: Set<string>,
): Set<string> {
  const depths = [...parentsByDepth.keys()].sort((a, b) => b - a);
  for (const d of depths) {
    const parentsAtDepth = parentsByDepth.get(d) ?? [];
    const stillExpanded = parentsAtDepth.filter((id) => !collapsed.has(id));
    if (stillExpanded.length === 0) continue;
    const next = new Set(collapsed);
    for (const id of stillExpanded) next.add(id);
    return next;
  }
  return collapsed;
}

/**
 * Inverse of `collapseDeepestExpandedLayer` — reveals the shallowest
 * collapsed layer, working back down toward the leaves.
 */
function expandShallowestCollapsedLayer(
  parentsByDepth: Map<number, string[]>,
  collapsed: Set<string>,
): Set<string> {
  if (collapsed.size === 0) return collapsed;
  const depths = [...parentsByDepth.keys()].sort((a, b) => a - b);
  for (const d of depths) {
    const parentsAtDepth = parentsByDepth.get(d) ?? [];
    const collapsedAtDepth = parentsAtDepth.filter((id) => collapsed.has(id));
    if (collapsedAtDepth.length === 0) continue;
    const next = new Set(collapsed);
    for (const id of collapsedAtDepth) next.delete(id);
    return next;
  }
  return collapsed;
}

export const WaterfallView = memo(function WaterfallView({
  spans,
  selectedSpanId,
  promptSpanIds,
  onSelectSpan,
  onClearSpan,
}: WaterfallViewProps) {
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [treePct, setTreePct] = useState(DEFAULT_TREE_PCT);
  const [showOnlyLangwatch, setShowOnlyLangwatch] = useState(false);

  const { isEditing, deletedSpanIds, draftNames, toggleSpanDeleted } = useWaterfallEditing(spans);
  const { correctedSpanIds, deletedByCorrectionSpanIds } = useCorrectionMarks(spans);

  const { signalsBySpanId, isFetched: signalsFetched } = useSpanLangwatchSignals();
  const hasAnySignals = signalsBySpanId.size > 0;
  const { logsBySpanId } = useSpanLogs();

  // What was said about each span, read once for the whole tree: a hundred rows
  // each asking for the trace's comments is a hundred subscriptions to one
  // answer. Only comments about a span as a whole belong on its row — the ones
  // about its fields read on the sections holding those fields.
  const { traceId } = useTraceQueryArgs();
  const rowTraceId = traceId ?? undefined;
  const annotations = useAnchoredAnnotations();
  const commentsBySpanId = useMemo(() => groupCommentsBySpan(annotations.all), [annotations.all]);
  const commentsFor = useCallback(
    (spanId: string) => commentsBySpanId.get(spanId) ?? EMPTY_COMMENTS,
    [commentsBySpanId],
  );

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
  const filteredSpans = useMemo<SpanTreeNode[]>(
    () => (showOnlyLangwatch ? spansWithSignalsAndAncestors(spans, signalsBySpanId) : spans),
    [spans, signalsBySpanId, showOnlyLangwatch],
  );

  const tree = useMemo(() => buildTree(filteredSpans), [filteredSpans]);
  const flatRows = useMemo(
    () => flattenTree(tree, collapsedIds, expandedGroups),
    [tree, collapsedIds, expandedGroups],
  );

  // When SSE delivers a new span for the trace currently in the drawer, the waterfall
  // used to wash itself with an Aurora gradient — which forced a layout cascade through
  // the virtualizer every time.
  const prevSpanIdsRef = useRef<Set<string> | null>(null);
  const prevRootSpanIdRef = useRef<string | null>(null);
  const currentRootSpanId = spans[0]?.spanId ?? null;
  useEffect(() => {
    pulseArrivedSpans({
      currentIds: new Set(spans.map((s) => s.spanId)),
      currentRootSpanId,
      prevRootSpanIdRef,
      prevSpanIdsRef,
    });
  }, [spans, currentRootSpanId]);
  const { rootStart, rootDuration } = useMemo(() => getTraceRange(filteredSpans), [filteredSpans]);
  const timeMarkers = useMemo(() => getTimeMarkers(rootDuration), [rootDuration]);

  // Drop interior markers when the timeline panel is narrow enough that adjacent labels
  // would collide.
  const [timelinePanelWidth, setTimelinePanelWidth] = useState(0);
  const timelineObserverRef = useRef<ResizeObserver | null>(null);
  const timelinePanelRef = useCallback((el: HTMLDivElement | null) => {
    timelineObserverRef.current?.disconnect();
    timelineObserverRef.current = observeClientWidth(el, setTimelinePanelWidth);
  }, []);
  const visibleTimeMarkers = useMemo(
    () => markersThatFit(timeMarkers, timelinePanelWidth),
    [timeMarkers, timelinePanelWidth],
  );

  // Below COLLAPSE_TIMELINE_BELOW_PX, drop the timeline/flame-graph panel entirely and
  // give the span list the full width — a squeezed timeline (hairline bars, a divider
  // eating space, truncated labels) is less useful than the list is, at that width.
  const [containerWidth, setContainerWidth] = useState(0);
  useEffect(() => {
    const observer = observeClientWidth(containerRef.current, setContainerWidth);
    return () => observer?.disconnect();
  }, []);
  const showTimeline = shouldShowTimeline(containerWidth);

  // Horizontal-scroll floor for the tree pane.
  const treeContentMinWidthPx = useMemo(() => treeMinWidthPx(flatRows), [flatRows]);

  // Detect multi-root (forest)
  const rootCount = useMemo(() => tree.length, [tree]);

  const handleToggleCollapse = useCallback((spanId: string) => {
    setCollapsedIds((prev) => withIdToggled(prev, spanId));
  }, []);

  const handleToggleGroup = useCallback((groupKey: string) => {
    setExpandedGroups((prev) => withIdToggled(prev, groupKey));
  }, []);

  // Parent spans keyed by depth — drives the Expand More / Collapse
  // More step-through. Built from the same tree the rows render from
  // so the depths line up with what the user sees.
  const parentsByDepth = useMemo(() => parentSpanIdsByDepth(tree), [tree]);

  const handleCollapseMore = useCallback(() => {
    // Collapse the deepest currently-expanded layer first, then the
    // next layer up on subsequent clicks. Each click peels one level
    // off the tree until only the root remains visible.
    setCollapsedIds((prev) => collapseDeepestExpandedLayer(parentsByDepth, prev));
  }, [parentsByDepth]);

  const handleExpandMore = useCallback(() => {
    // Inverse of `handleCollapseMore` — reveal the shallowest collapsed
    // layer per click, working back down toward the leaves.
    setCollapsedIds((prev) => expandShallowestCollapsedLayer(parentsByDepth, prev));
  }, [parentsByDepth]);

  // Identity-stable: reads the current selection through a ref so the
  // memoized rows don't all get a fresh callback when selection changes.
  const selectedSpanIdRef = useRef(selectedSpanId);
  selectedSpanIdRef.current = selectedSpanId;
  const handleSelectSpan = useCallback(
    (spanId: string) =>
      spanId === selectedSpanIdRef.current ? onClearSpan() : onSelectSpan(spanId),
    [onSelectSpan, onClearSpan],
  );

  // Row height estimator for virtualizer
  const getRowHeight = useCallback((index: number) => rowHeight(flatRows[index]), [flatRows]);

  // Single virtualizer drives both panels
  const virtualizer = useVirtualizer({
    count: flatRows.length,
    getScrollElement: () => treeScrollRef.current,
    estimateSize: getRowHeight,
    overscan: 15,
  });

  useScrollSelectedSpanIntoView({
    selectedSpanId,
    rows: flatRows,
    spans: filteredSpans,
    virtualizer,
    setCollapsedIds,
    setExpandedGroups,
    groupKeyOf: siblingGroupKey,
  });

  // Tree drives the timeline via a compositor-only `transform`. The rAF
  // guard collapses bursts of scroll events to one transform write per
  // frame (no React re-render between scrolls).
  const scrollFrameRef = useRef(0);
  const handleTreeScroll = useCallback(() => {
    if (scrollFrameRef.current) return;
    scrollFrameRef.current = requestAnimationFrame(() =>
      followTreeScroll({ scrollFrameRef, timelineContentRef, treeScrollRef }),
    );
  }, []);

  useEffect(() => () => cancelScrollFrame(scrollFrameRef), []);

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

  useEffect(() => listenForDividerDrag({ containerRef, isDraggingDivider, setTreePct }), []);

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
        width={showTimeline ? `${treePct * 100}%` : "100%"}
        minWidth={showTimeline ? `${MIN_TREE_WIDTH}px` : undefined}
        flexShrink={0}
        height="full"
        overflow="hidden"
      >
        <TreeHeader
          hasAnySignals={hasAnySignals}
          onCollapseMore={handleCollapseMore}
          onExpandMore={handleExpandMore}
          onToggleOnlyLangwatch={() => setShowOnlyLangwatch((v) => !v)}
          showOnlyLangwatch={showOnlyLangwatch}
          signalsFetched={signalsFetched}
        />

        {/* Tree rows (virtualized) */}
        <Box
          ref={treeScrollRef}
          flex={1}
          overflowY="auto"
          overflowX="auto"
          onScroll={handleTreeScroll}
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
            position="relative"
            height={`${virtualizer.getTotalSize()}px`}
            width="full"
            minWidth={`${treeContentMinWidthPx}px`}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => (
              <WaterfallVirtualRow
                key={virtualRowKey(flatRows[virtualRow.index]!)}
                collapsedIds={collapsedIds}
                commentsFor={commentsFor}
                correctedSpanIds={correctedSpanIds}
                deletedByCorrectionSpanIds={deletedByCorrectionSpanIds}
                deletedSpanIds={deletedSpanIds}
                draftNames={draftNames}
                expandedGroups={expandedGroups}
                index={virtualRow.index}
                isEditing={isEditing}
                logsBySpanId={logsBySpanId}
                onSelectSpan={handleSelectSpan}
                onToggleCollapse={handleToggleCollapse}
                onToggleGroup={handleToggleGroup}
                onToggleSpanDeleted={toggleSpanDeleted}
                promptSpanIds={promptSpanIds}
                rootCount={rootCount}
                rootDuration={rootDuration}
                rootStart={rootStart}
                row={flatRows[virtualRow.index]!}
                rowTraceId={rowTraceId}
                selectedSpanId={selectedSpanId}
                signalsBySpanId={signalsBySpanId}
                size={virtualRow.size}
                start={virtualRow.start}
              />
            ))}
          </Box>
        </Box>
      </Flex>

      {/* Resizable divider + timeline panel — dropped entirely below
          COLLAPSE_TIMELINE_BELOW_PX; nothing to divide or show. */}
      {showTimeline && (
        <TimelinePanel
          flatRows={flatRows}
          onDividerStart={handleDividerStart}
          onSelectSpan={handleSelectSpan}
          onTimelineWheel={handleTimelineWheel}
          rootDuration={rootDuration}
          rootStart={rootStart}
          selectedSpanId={selectedSpanId}
          timelineContentRef={timelineContentRef}
          timelinePanelRef={timelinePanelRef}
          virtualizer={virtualizer}
          visibleTimeMarkers={visibleTimeMarkers}
        />
      )}
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

/** One folded group of repeated siblings, positioned by the virtualizer. */
function GroupVirtualRow({
  group,
  size,
  start,
  expandedGroups,
  onToggle,
}: {
  group: Extract<FlatRow, { kind: "group" }>;
  size: number;
  start: number;
  expandedGroups: Set<string>;
  onToggle: (groupKey: string) => void;
}) {
  const groupKey = siblingGroupKey(group);
  return (
    <Box
      position="absolute"
      top={0}
      left={0}
      width="full"
      height={`${size}px`}
      transform={`translateY(${start}px)`}
    >
      <GroupRow
        group={group}
        groupKey={groupKey}
        isExpanded={expandedGroups.has(groupKey)}
        onToggle={onToggle}
      />
    </Box>
  );
}

/**
 * Only comments about a span as a whole belong on its row — the ones about its
 * fields read on the sections holding those fields.
 */
function groupCommentsBySpan(all: AnnotationByTrace[]): Map<string, AnnotationByTrace[]> {
  const map = new Map<string, AnnotationByTrace[]>();
  for (const annotation of all) {
    if (annotation.anchorKind !== "span" || !annotation.anchorId) continue;
    const list = map.get(annotation.anchorId);
    if (list) list.push(annotation);
    else map.set(annotation.anchorId, [annotation]);
  }
  return map;
}

/**
 * Spans that carry signals, plus their ancestors, so the tree structure stays
 * meaningful — selecting a leaf shouldn't strand it under an invisible parent.
 */
function spansWithSignalsAndAncestors(
  spans: SpanTreeNode[],
  signalsBySpanId: ReturnType<typeof useSpanLangwatchSignals>["signalsBySpanId"],
): SpanTreeNode[] {
  const byId = new Map(spans.map((s) => [s.spanId, s]));
  const kept = new Set<string>();
  for (const span of spans) {
    if ((signalsBySpanId.get(span.spanId)?.length ?? 0) === 0) continue;
    let cursor: SpanTreeNode | undefined = span;
    while (cursor && !kept.has(cursor.spanId)) {
      kept.add(cursor.spanId);
      cursor = cursor.parentSpanId ? byId.get(cursor.parentSpanId) : undefined;
    }
  }
  return spans.filter((s) => kept.has(s.spanId));
}

/**
 * Pulses the spans that just arrived. A different trace, or a first render,
 * only records what is on screen: everything would otherwise pulse at once.
 */
function pulseArrivedSpans({
  currentIds,
  currentRootSpanId,
  prevRootSpanIdRef,
  prevSpanIdsRef,
}: {
  currentIds: Set<string>;
  currentRootSpanId: string | null;
  prevRootSpanIdRef: { current: string | null };
  prevSpanIdsRef: { current: Set<string> | null };
}): void {
  const prev = prevSpanIdsRef.current;
  const sameTrace = prevRootSpanIdRef.current === currentRootSpanId;
  prevRootSpanIdRef.current = currentRootSpanId;
  prevSpanIdsRef.current = currentIds;
  if (!sameTrace || prev === null) return;
  const pulse = useSpanPulseStore.getState().pulse;
  for (const id of currentIds) {
    if (!prev.has(id)) pulse(id);
  }
}

/** Reports an element's width now and on every resize, until disconnected. */
function observeClientWidth(
  el: HTMLElement | null,
  report: (width: number) => void,
): ResizeObserver | null {
  if (!el) return null;
  report(el.clientWidth);
  const observer = new ResizeObserver(() => report(el.clientWidth));
  observer.observe(el);
  return observer;
}

/**
 * Interior markers are dropped when the timeline panel is narrow enough that
 * adjacent labels would collide. ~60px per label keeps neighbours apart even at
 * the longest "00.0s" duration string; the first and last always show.
 */
function markersThatFit<T>(timeMarkers: T[], panelWidth: number): T[] {
  if (timeMarkers.length <= 2) return timeMarkers;
  const PER_LABEL_PX = 60;
  const maxLabels = Math.max(2, Math.floor(panelWidth / PER_LABEL_PX));
  if (timeMarkers.length <= maxLabels) return timeMarkers;
  const last = timeMarkers.length - 1;
  const interiorBudget = Math.max(0, maxLabels - 2);
  if (interiorBudget === 0) return [timeMarkers[0]!, timeMarkers[last]!];
  const interior = timeMarkers.slice(1, -1);
  const stride = Math.ceil(interior.length / interiorBudget);
  return [timeMarkers[0]!, ...interior.filter((_, i) => i % stride === 0), timeMarkers[last]!];
}

/** Horizontal-scroll floor for the tree pane: the deepest row plus its label. */
function treeMinWidthPx(flatRows: ReturnType<typeof flattenTree>): number {
  let maxDepth = 0;
  for (const row of flatRows) {
    const depth = row.kind === "group" ? row.depth : row.node.depth;
    if (depth > maxDepth) maxDepth = depth;
  }
  return maxDepth * INDENT_PX + 240;
}

/** The set with one id flipped. */
function withIdToggled(ids: Set<string>, id: string): Set<string> {
  const next = new Set(ids);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/**
 * Parent spans keyed by depth, driving the Expand More / Collapse More
 * step-through. Built from the tree the rows render from, so the depths line up
 * with what the reader sees.
 */
function parentSpanIdsByDepth(tree: ReturnType<typeof buildTree>): Map<number, string[]> {
  const map = new Map<number, string[]>();
  const walk = (nodes: ReturnType<typeof buildTree>) => {
    for (const node of nodes) {
      if (node.children.length === 0) continue;
      const list = map.get(node.depth) ?? [];
      list.push(node.span.spanId);
      map.set(node.depth, list);
      walk(node.children);
    }
  };
  walk(tree);
  return map;
}

/** One frame of the timeline following the tree's scroll, compositor-only. */
function followTreeScroll({
  scrollFrameRef,
  timelineContentRef,
  treeScrollRef,
}: {
  scrollFrameRef: { current: number };
  timelineContentRef: { current: HTMLDivElement | null };
  treeScrollRef: { current: HTMLDivElement | null };
}): void {
  scrollFrameRef.current = 0;
  const tree = treeScrollRef.current;
  const timeline = timelineContentRef.current;
  if (!tree || !timeline) return;
  timeline.style.transform = `translateY(${-tree.scrollTop}px)`;
}

function cancelScrollFrame(scrollFrameRef: { current: number }): void {
  if (!scrollFrameRef.current) return;
  cancelAnimationFrame(scrollFrameRef.current);
  scrollFrameRef.current = 0;
}

/** Follows the divider while it is held, and releases the cursor when it isn't. */
function listenForDividerDrag({
  containerRef,
  isDraggingDivider,
  setTreePct,
}: {
  containerRef: { current: HTMLDivElement | null };
  isDraggingDivider: { current: boolean };
  setTreePct: (pct: number) => void;
}): () => void {
  const handleMove = (e: MouseEvent) => {
    if (!isDraggingDivider.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    setTreePct(Math.min(0.7, Math.max(MIN_TREE_WIDTH / rect.width, x / rect.width)));
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
}

/** A virtual row's React key: group rows key by their sibling group, spans by id. */
function virtualRowKey(row: ReturnType<typeof flattenTree>[number]): string {
  return row.kind === "group" ? `group-${siblingGroupKey(row)}` : row.node.span.spanId;
}

/** One virtualized waterfall row: a sibling group header, or a span. */
function WaterfallVirtualRow({
  collapsedIds,
  commentsFor,
  correctedSpanIds,
  deletedByCorrectionSpanIds,
  deletedSpanIds,
  draftNames,
  expandedGroups,
  index,
  isEditing,
  logsBySpanId,
  onSelectSpan,
  onToggleCollapse,
  onToggleGroup,
  onToggleSpanDeleted,
  promptSpanIds,
  rootCount,
  rootDuration,
  rootStart,
  row,
  rowTraceId,
  selectedSpanId,
  signalsBySpanId,
  size,
  start,
}: {
  collapsedIds: Set<string>;
  commentsFor: (spanId: string) => AnnotationByTrace[];
  correctedSpanIds: Set<string>;
  deletedByCorrectionSpanIds: Set<string>;
  deletedSpanIds: Set<string>;
  draftNames: ReadonlyMap<string, string>;
  expandedGroups: Set<string>;
  index: number;
  isEditing: boolean;
  logsBySpanId: ReturnType<typeof useSpanLogs>["logsBySpanId"];
  onSelectSpan: (spanId: string) => void;
  onToggleCollapse: (spanId: string) => void;
  onToggleGroup: (groupKey: string) => void;
  onToggleSpanDeleted: (spanId: string) => void;
  promptSpanIds: WaterfallViewProps["promptSpanIds"];
  rootCount: number;
  rootDuration: number;
  rootStart: number;
  row: ReturnType<typeof flattenTree>[number];
  rowTraceId: string | undefined;
  selectedSpanId: string | null;
  signalsBySpanId: ReturnType<typeof useSpanLangwatchSignals>["signalsBySpanId"];
  size: number;
  start: number;
}) {
  if (row.kind === "group") {
    return (
      <GroupVirtualRow
        key={`group-${siblingGroupKey(row)}`}
        group={row}
        size={size}
        start={start}
        expandedGroups={expandedGroups}
        onToggle={onToggleGroup}
      />
    );
  }
  const { node } = row;
  const isRoot = node.depth === 0;
  const showSeparator = isRoot && rootCount > 1 && index > 0;
  return (
    <Box
      key={node.span.spanId}
      position="absolute"
      top={0}
      left={0}
      width="full"
      height={`${size}px`}
      transform={`translateY(${start}px)`}
      // The row's actions hang below it, over the row after it. Its
      // own transform makes it a stacking context, so nothing
      // inside can paint over a later row: the lift has to happen
      // here. In CSS rather than in state, so moving the pointer
      // down a long tree re-renders nothing.
      _hover={{ zIndex: 2 }}
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
        isPrompt={promptSpanIds?.has(node.span.spanId) ?? false}
        logCount={logsBySpanId.get(node.span.spanId)?.length ?? 0}
        isCollapsed={collapsedIds.has(node.span.spanId)}
        hasChildren={node.children.length > 0}
        hiddenDescendantCount={collapsedIds.has(node.span.spanId) ? countDescendants(node) : 0}
        isDimmed={selectedSpanId !== null && node.span.spanId !== selectedSpanId}
        signals={signalsBySpanId.get(node.span.spanId) ?? EMPTY_SIGNALS}
        traceId={rowTraceId}
        comments={commentsFor(node.span.spanId)}
        isEditing={isEditing}
        isDraftDeleted={deletedSpanIds.has(node.span.spanId)}
        isCorrected={correctedSpanIds.has(node.span.spanId)}
        isDeletedByCorrection={deletedByCorrectionSpanIds.has(node.span.spanId)}
        draftName={draftNames.get(node.span.spanId)}
        onToggleDelete={onToggleSpanDeleted}
        onToggleCollapse={onToggleCollapse}
        onSelect={onSelectSpan}
      />
    </Box>
  );
}

/**
 * The resizable divider and the timeline beside the tree. Dropped entirely
 * below COLLAPSE_TIMELINE_BELOW_PX — there is nothing left to divide or show.
 */
function TimelinePanel({
  flatRows,
  onDividerStart,
  onSelectSpan,
  onTimelineWheel,
  rootDuration,
  rootStart,
  selectedSpanId,
  timelineContentRef,
  timelinePanelRef,
  virtualizer,
  visibleTimeMarkers,
}: {
  flatRows: ReturnType<typeof flattenTree>;
  onDividerStart: (e: React.MouseEvent) => void;
  onSelectSpan: (spanId: string) => void;
  onTimelineWheel: (e: React.WheelEvent) => void;
  rootDuration: number;
  rootStart: number;
  selectedSpanId: string | null;
  timelineContentRef: React.RefObject<HTMLDivElement | null>;
  timelinePanelRef: (el: HTMLDivElement | null) => void;
  virtualizer: ReturnType<typeof useVirtualizer<HTMLDivElement, Element>>;
  visibleTimeMarkers: number[];
}) {
  return (
    <>
      <Box
        width="5px"
        flexShrink={0}
        cursor="col-resize"
        position="relative"
        zIndex={2}
        onMouseDown={onDividerStart}
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
          // Light mode: lean on the darker `border.emphasized` token so the divider
          // doesn't vanish against the white-ish surface.
          bg={{ base: "border.emphasized", _dark: "border" }}
          opacity={0.5}
          transition="all 0.15s ease"
        />
      </Box>

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
          <Box position="absolute" top={0} bottom={0} left={2} right={4}>
            {visibleTimeMarkers.map((ms, idx) => {
              const pct = rootDuration > 0 ? (ms / rootDuration) * 100 : 0;
              const isLast = idx === visibleTimeMarkers.length - 1;
              const isFirst = idx === 0;
              const innerTransform = isFirst ? "translateY(-50%)" : "translate(-50%, -50%)";
              const tickTransform = isLast ? "translate(-100%, -50%)" : innerTransform;
              return (
                <Text
                  key={idx}
                  textStyle="xs"
                  color="fg.subtle"
                  position="absolute"
                  top="50%"
                  left={`${pct}%`}
                  transform={tickTransform}
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
        <Box flex={1} overflow="hidden" position="relative" onWheel={onTimelineWheel}>
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
                    key={`group-tl-${siblingGroupKey(row)}`}
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
                    isDimmed={selectedSpanId !== null && node.span.spanId !== selectedSpanId}
                    onSelect={onSelectSpan}
                  />
                </Box>
              );
            })}
          </Box>
        </Box>
      </Flex>
    </>
  );
}

/** The tree pane's header: the column label and the tree-wide controls. */
function TreeHeader({
  hasAnySignals,
  onCollapseMore,
  onExpandMore,
  onToggleOnlyLangwatch,
  showOnlyLangwatch,
  signalsFetched,
}: {
  hasAnySignals: boolean;
  onCollapseMore: () => void;
  onExpandMore: () => void;
  onToggleOnlyLangwatch: () => void;
  showOnlyLangwatch: boolean;
  signalsFetched: boolean;
}) {
  return (
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
              onClick={onToggleOnlyLangwatch}
              aria-pressed={showOnlyLangwatch}
            >
              <Icon as={LuSparkles} boxSize={3} />
            </chakra.button>
          </Tooltip>
        )}
        <ToolbarIconButton
          tooltip="Expand one level"
          icon={LuChevronsUpDown}
          onClick={onExpandMore}
        />
        <ToolbarIconButton
          tooltip="Collapse one level"
          icon={LuChevronsDownUp}
          onClick={onCollapseMore}
        />
      </HStack>
    </Flex>
  );
}

/** Row height estimate for the virtualizer: group headers and two-line spans are taller. */
function rowHeight(row: ReturnType<typeof flattenTree>[number] | undefined): number {
  if (!row) return ROW_HEIGHT;
  if (row.kind === "group") return GROUP_ROW_HEIGHT;
  return isTwoLineSpan(row.node.span) ? LLM_ROW_HEIGHT : ROW_HEIGHT;
}
