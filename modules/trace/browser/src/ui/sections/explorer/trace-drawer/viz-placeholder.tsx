import { Kbd } from "@langwatch/design-system/kbd";
import {
  Box,
  Flex,
  HStack,
  Icon,
  Skeleton,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";
import type { SpanTreeNode, TraceHeader } from "@langwatch/trace-contract";
import { lazy, Suspense, useMemo, useRef } from "react";
import {
  LuChartGantt,
  LuChevronDown,
  LuChevronUp,
  LuFlame,
  LuGripHorizontal,
  LuMessagesSquare,
  LuMinus,
  LuNetwork,
  LuPanelBottomOpen,
  LuPanelRightOpen,
} from "react-icons/lu";
import { useShallow } from "zustand/react/shallow";

import type { VizTab } from "../../../../model/trace-drawer-params.ts";
import { useTraceDrawer } from "../../../../behavior/trace-drawer.ts";
import { useVizHeight } from "../../../../behavior/explorer/trace-drawer/use-viz-height.ts";
import { useOverflowVisibility } from "../../../../behavior/explorer/use-overflow-visibility.ts";
// PeerCursorOverlay used to wrap just the viz pane (scoped to the
// active viz tab). It was lifted to the drawer level (TraceDrawerShell)
// so cursors render anywhere a peer's cursor lands in the drawer — the
// previous scope hid peers as soon as they hovered out of the
// viz pane.
import {
  selectPeersMatching,
  usePresenceStore,
} from "../../../../behavior/presence/presence-store.ts";
import { SequenceSkeleton } from "../../../blocks/sequence/sequence-skeleton.tsx";
import { TopologySkeleton } from "../../../blocks/sequence/topology-skeleton.tsx";
import { OverflowMenu } from "../../../elements/explorer/shared/overflow-menu.tsx";
import { PresenceMarker } from "../../../elements/presence/presence-marker.tsx";
import { FlameView } from "../../flame/flame-view.tsx";
import { spanTypeColor } from "../utils/span-type-color.ts";
import { WaterfallView } from "./waterfall-view/index.ts";

// SequenceView pulls in `mermaid` (~1MB+ — d3, dagre, several parsers).
// That's the only viz heavy enough to keep code-split — the others are
// statically imported so tab switches stay synchronous.
const SequenceView = lazy(() =>
  import("../../sequence/sequence-view.tsx").then((m) => ({ default: m.SequenceView })),
);

interface VizPlaceholderProps {
  vizTab: VizTab;
  onVizTabChange: (tab: VizTab) => void;
  trace: TraceHeader | null;
  spans: SpanTreeNode[];
  isLoading?: boolean;
  selectedSpanId: string | null;
  onSelectSpan: (spanId: string) => void;
  onClearSpan: () => void;
  /**
   * When true, the viz fills its parent's full height — the internal height state and
   * the bottom resize handle are skipped because the parent (`<PanelGroup>` from
   * `react-resizable-panels`) owns sizing.
   */
  fillParent?: boolean;
  /**
   * Layout orientation of the parent pane group. Drives which icon the
   * "show details" affordance uses when the detail pane is collapsed —
   * right-pointing for a side-by-side split, top/bottom for stacked.
   */
  paneLayout?: "horizontal" | "vertical";
}

function VizTabPresenceDot({ traceId, panel }: { traceId: string; panel: VizTab }) {
  const peers = usePresenceStore(
    useShallow((s) =>
      selectPeersMatching(
        s,
        (session) =>
          session.location.route.traceId === traceId && session.location.view?.panel === panel,
      ),
    ),
  );
  if (peers.length === 0) return null;
  return <PresenceMarker peers={peers} size={16} tooltipSuffix={`${panel} panel`} />;
}

interface VizTabDef {
  value: VizTab;
  label: string;
  icon: typeof LuChartGantt;
  shortcut: string;
  palette: string;
  description: string;
}

/**
 * Shared icon + label + shortcut + presence-dot row used by both the in-row tab AND the
 * overflow menu's dropdown entries.
 */
function VizTabContent({ tab, traceId }: { tab: VizTabDef; traceId: string | null }) {
  return (
    <>
      <Icon as={tab.icon} boxSize={3.5} />
      <Text textStyle="xs" lineHeight={1}>
        {tab.label}
      </Text>
      <Kbd>{tab.shortcut}</Kbd>
      {traceId ? <VizTabPresenceDot traceId={traceId} panel={tab.value} /> : null}
    </>
  );
}

// The viz strip ships four tabs as of Round 3. Span List stays retired — it added
// filter chrome but no fundamentally new data axis, and the waterfall + sidebar filter
// together cover the same workflow.
const TABS: VizTabDef[] = [
  {
    value: "waterfall",
    label: "Waterfall",
    icon: LuChartGantt,
    shortcut: "1",
    palette: "blue",
    description:
      "Spans laid out by start time with parent/child indentation: best for tracing causality top-down.",
  },
  {
    value: "flame",
    label: "Flame",
    icon: LuFlame,
    shortcut: "2",
    palette: "orange",
    description:
      "Spans laid out by depth with width proportional to duration: best for spotting hot paths and time-skewed children.",
  },
  {
    value: "topology",
    label: "Topology",
    icon: LuNetwork,
    shortcut: "3",
    palette: "purple",
    description:
      "Service/agent graph showing what calls what: best for understanding system structure at a glance.",
  },
  {
    value: "sequence",
    label: "Sequence",
    icon: LuMessagesSquare,
    shortcut: "4",
    palette: "teal",
    description:
      "Chat-style turn order between actors: best for replaying multi-agent conversations.",
  },
];

/**
 * The tab row. When the container is too narrow for every tab, the ones that
 * would clip fold into an overflow menu after the visible tabs.
 */
function VizTabStrip({
  vizTab,
  traceId,
  onVizTabChange,
}: {
  vizTab: VizTab;
  traceId: string | null;
  onVizTabChange: (tab: VizTab) => void;
}) {
  const tabScrollerRef = useRef<HTMLDivElement>(null);
  const tabIds = useMemo(() => TABS.map((t) => t.value), []);
  const hiddenTabIds = useOverflowVisibility({
    scrollerRef: tabScrollerRef,
    items: tabIds,
    activeId: vizTab,
    // Just enough headroom for the overflow trigger (~22px); more folded tabs
    // that visibly fit.
    reservePx: 26,
  });

  return (
    <HStack ref={tabScrollerRef} gap={0} overflowX="hidden" flexWrap="nowrap" flex="1" minWidth={0}>
      {TABS.map((tab) => (
        <VizTabButton
          key={tab.value}
          tab={tab}
          traceId={traceId}
          isActive={vizTab === tab.value}
          isHidden={hiddenTabIds.has(tab.value)}
          onSelect={onVizTabChange}
        />
      ))}
      {/* Pushes the overflow trigger to the far right, so it reads as the row's control. */}
      <Box flex={1} minWidth={0} />
      <OverflowMenu
        items={TABS.filter((t) => hiddenTabIds.has(t.value)).map((t) => ({
          id: t.value,
          label: t.label,
          content: (
            <HStack gap={1.5} flex={1} color={`${t.palette}.fg`}>
              <VizTabContent tab={t} traceId={traceId} />
            </HStack>
          ),
        }))}
        activeId={vizTab}
        onSelect={(id) => {
          const tab = TABS.find((t) => t.value === id);
          if (tab) onVizTabChange(tab.value);
        }}
        ariaLabel="Show more viz tabs"
      />
    </HStack>
  );
}

function VizTabButton({
  tab,
  traceId,
  isActive,
  isHidden,
  onSelect,
}: {
  tab: VizTabDef;
  traceId: string | null;
  isActive: boolean;
  isHidden: boolean;
  onSelect: (tab: VizTab) => void;
}) {
  const activeBg = `${tab.palette}.subtle`;
  return (
    <Tooltip content={tab.description} positioning={{ placement: "top" }} openDelay={400}>
      <Flex
        as="button"
        data-overflow-id={tab.value}
        align="center"
        gap={1.5}
        paddingX={2}
        paddingY={1}
        marginY={1}
        borderRadius="md"
        cursor="pointer"
        // Light mode: inactive tabs are neutral grey, so the strip does not read
        // as a wall of saturated colour on the muted surface.
        color={isActive ? `${tab.palette}.fg` : { base: "fg.muted", _dark: `${tab.palette}.fg` }}
        bg={isActive ? activeBg : "transparent"}
        flexShrink={0}
        whiteSpace="nowrap"
        display={isHidden ? "none" : "flex"}
        _hover={{ bg: isActive ? activeBg : "bg.muted" }}
        transition="background 0.15s ease"
        onClick={() => onSelect(tab.value)}
        fontWeight={isActive ? "600" : "500"}
      >
        <VizTabContent tab={tab} traceId={traceId} />
      </Flex>
    </Tooltip>
  );
}

/** Cycles the stand-alone panel: minimised, default, expanded. */
function ResizeCycleButton({
  isMinimized,
  isExpanded,
  onClick,
}: {
  isMinimized: boolean;
  isExpanded: boolean;
  onClick: () => void;
}) {
  const expandedLabel = isExpanded ? "Minimize" : "Expand";
  const expandedIcon = isExpanded ? LuMinus : LuChevronUp;
  const label = isMinimized ? "Show" : expandedLabel;
  const icon = isMinimized ? LuChevronDown : expandedIcon;
  return (
    <HStack gap={1.5}>
      <Tooltip content={label} positioning={{ placement: "top" }}>
        <Flex
          as="button"
          align="center"
          justify="center"
          width="24px"
          height="24px"
          borderRadius="md"
          cursor="pointer"
          color="fg.muted"
          _hover={{ bg: "bg.muted", color: "fg" }}
          transition="all 0.15s ease"
          onClick={onClick}
        >
          <Icon as={icon} boxSize={3.5} />
        </Flex>
      </Tooltip>
    </HStack>
  );
}

/**
 * Brings the hidden detail pane back without selecting a span. Selecting one
 * reopens it too; this is the escape for seeing the trace summary again.
 */
function ShowDetailsButton({
  paneLayout,
  onClick,
}: {
  paneLayout?: "horizontal" | "vertical";
  onClick: () => void;
}) {
  return (
    <Tooltip content="Show details" positioning={{ placement: "top" }}>
      <Flex
        as="button"
        align="center"
        justify="center"
        width="28px"
        marginX={1}
        cursor="pointer"
        color="fg.muted"
        _hover={{ bg: "bg.muted", color: "fg" }}
        borderRadius="md"
        alignSelf="center"
        height="26px"
        flexShrink={0}
        // Above the collapsed pane's resize hit-zone (z-index 2 in PaneResizeBar).
        position="relative"
        zIndex={3}
        aria-label="Show details"
        onClick={onClick}
      >
        <Icon
          as={paneLayout === "horizontal" ? LuPanelRightOpen : LuPanelBottomOpen}
          boxSize={3.5}
        />
      </Flex>
    </Tooltip>
  );
}

function ResizeHandle({ onStart }: { onStart: (e: React.MouseEvent | React.TouchEvent) => void }) {
  return (
    <Flex
      align="center"
      justify="center"
      height="12px"
      cursor="row-resize"
      color="fg.subtle"
      _hover={{ color: "fg.muted", bg: "bg.subtle/60" }}
      transition="all 0.15s ease"
      onMouseDown={onStart}
      onTouchStart={onStart}
      userSelect="none"
      flexShrink={0}
    >
      <Icon as={LuGripHorizontal} boxSize={3.5} />
    </Flex>
  );
}

export function VizPlaceholder({
  vizTab,
  onVizTabChange,
  trace,
  spans,
  isLoading = false,
  selectedSpanId,
  onSelectSpan,
  onClearSpan,
  fillParent = false,
  paneLayout,
}: VizPlaceholderProps) {
  // Span ids carrying a managed prompt. The trace summary already rolls
  // up the selected + last-used prompt span ids, which is enough to flag
  // prompt-bearing spans in the waterfall without loading full span
  // params just for an icon.
  const selectedPromptSpanId = trace?.selectedPromptSpanId;
  const lastUsedPromptSpanId = trace?.lastUsedPromptSpanId;
  const promptSpanIds = useMemo(
    () => new Set([selectedPromptSpanId, lastUsedPromptSpanId].filter((id): id is string => !!id)),
    [selectedPromptSpanId, lastUsedPromptSpanId],
  );

  // When the detail pane is hidden, surface a "Show details" affordance
  // in the viz tab row so the user can bring it back without having to
  // click a span. The detail pane also auto-reopens whenever a span is
  // selected (see `getTraceDrawer().selectSpan`); this is the manual escape
  // for when the user wants to see the trace summary again.
  const detailCollapsed = useTraceDrawer((s) => s.paneState.spanDetail.collapsed);
  const togglePaneCollapsed = useTraceDrawer((s) => s.togglePaneCollapsed);

  const viz = useVizHeight({ fillParent, hasData: spans.length > 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const traceId = trace?.traceId ?? null;

  return (
    <Box
      ref={containerRef}
      height={fillParent ? "100%" : undefined}
      display={fillParent ? "flex" : undefined}
      flexDirection={fillParent ? "column" : undefined}
      minHeight={0}
    >
      <Box
        overflow="hidden"
        bg={{ base: "bg.surface", _dark: "bg.panel" }}
        flex={fillParent ? 1 : undefined}
        display={fillParent ? "flex" : undefined}
        flexDirection={fillParent ? "column" : undefined}
        minHeight={0}
      >
        {/* Tab bar — text + underline style, no gray pill background.
            Mirrors the Trace / Conversation mode switcher. Tabs scroll
            horizontally rather than wrapping when the row is narrower
            than its content. */}
        <Flex
          align="stretch"
          justify="space-between"
          paddingX={2}
          borderBottomWidth={viz.isMinimized ? "0px" : "1px"}
          borderColor="border"
          bg={{ base: "bg.surface", _dark: "bg.panel" }}
          flexShrink={0}
          minHeight="38px"
          data-spotlight="viz-tabs"
        >
          <VizTabStrip vizTab={vizTab} traceId={traceId} onVizTabChange={onVizTabChange} />
          {!fillParent && (
            <ResizeCycleButton
              isMinimized={viz.isMinimized}
              isExpanded={viz.isExpanded}
              onClick={viz.cycleSize}
            />
          )}
          {fillParent && detailCollapsed && (
            <ShowDetailsButton
              paneLayout={paneLayout}
              onClick={() => togglePaneCollapsed("spanDetail")}
            />
          )}
        </Flex>

        {/* Visualization content */}
        {!viz.isMinimized && (
          <Box
            height={fillParent ? undefined : `${viz.height}px`}
            flex={fillParent ? 1 : undefined}
            minHeight={0}
            overflow={fillParent ? "auto" : "hidden"}
            transition={fillParent ? undefined : viz.heightTransition}
            onClick={viz.isCollapsed ? viz.expandFromCollapsed : undefined}
            cursor={viz.isCollapsed ? "pointer" : "default"}
            position="relative"
            style={fillParent ? { overflowAnchor: "none" } : undefined}
          >
            <VizBody
              isCollapsed={viz.isCollapsed}
              isLoading={isLoading}
              onClearSpan={onClearSpan}
              onSelectSpan={onSelectSpan}
              promptSpanIds={promptSpanIds}
              selectedSpanId={selectedSpanId}
              spans={spans}
              vizTab={vizTab}
            />
            {/*
              The "Click to interact" scrim used to sit here. With the
              pane layout giving each viz its own scroll container, the
              overlay is redundant — wheel events scope to the pane the
              cursor is over and never bleed into the drawer body.
            */}
          </Box>
        )}

        {/* Stand-alone mode only; the pane layout resizes through <PanelResizeHandle>. */}
        {!fillParent && !viz.isMinimized && <ResizeHandle onStart={viz.resizeStart} />}
      </Box>
    </Box>
  );
}

// Each skeleton block uses Chakra's <Skeleton> which already provides the
// built-in shimmer animation. No custom keyframes needed — every block in
// every viz skeleton inherits the same loading shimmer for a consistent
// feel.

/**
 * Loading skeleton dispatched by the active viz tab.
 */
function VizSkeleton({ vizTab }: { vizTab?: VizTab }) {
  if (vizTab === "topology") return <TopologySkeleton />;
  if (vizTab === "sequence") return <SequenceSkeleton />;
  return <WaterfallSkeleton />;
}

const WATERFALL_ROWS = [
  { depth: 0, barLeft: 0, barWidth: 96 },
  { depth: 1, barLeft: 2, barWidth: 70 },
  { depth: 2, barLeft: 4, barWidth: 42 },
  { depth: 2, barLeft: 48, barWidth: 18 },
  { depth: 1, barLeft: 14, barWidth: 56 },
  { depth: 2, barLeft: 18, barWidth: 28 },
  { depth: 1, barLeft: 70, barWidth: 22 },
  { depth: 2, barLeft: 72, barWidth: 14 },
] as const;

function WaterfallSkeleton() {
  return (
    <Flex direction="row" height="full" position="relative">
      <VStack
        align="stretch"
        gap={1.5}
        flex={0.4}
        paddingX={3}
        paddingY={3}
        borderRightWidth="1px"
        borderColor="border.subtle"
      >
        {WATERFALL_ROWS.map((row, i) => (
          <Flex key={i} height="14px" align="center" gap={2}>
            <Box width={`${row.depth * 10}px`} flexShrink={0} />
            <Skeleton width="8px" height="8px" borderRadius="full" />
            <Skeleton height="8px" borderRadius="sm" flex={1} />
          </Flex>
        ))}
      </VStack>
      <VStack align="stretch" gap={1.5} flex={0.6} paddingX={3} paddingY={3}>
        {WATERFALL_ROWS.map((row, i) => (
          <Flex key={i} height="14px" align="center" position="relative">
            <Skeleton
              position="absolute"
              left={`${row.barLeft}%`}
              width={`${row.barWidth}%`}
              height="10px"
              borderRadius="sm"
            />
          </Flex>
        ))}
      </VStack>
    </Flex>
  );
}

function CollapsedOverview({ spans }: { spans: SpanTreeNode[] }) {
  const minStart = Math.min(...spans.map((s) => s.startTimeMs));
  const maxEnd = Math.max(...spans.map((s) => s.endTimeMs));
  const totalDuration = maxEnd - minStart || 1;

  return (
    <Flex align="center" height="full" paddingX={4} paddingY={2} gap={0} position="relative">
      <Box width="full" height="32px" position="relative" borderRadius="md" overflow="hidden">
        {spans.map((span) => {
          const left = ((span.startTimeMs - minStart) / totalDuration) * 100;
          const width = Math.max(0.5, ((span.endTimeMs - span.startTimeMs) / totalDuration) * 100);
          const isError = span.status === "error";
          const color = spanTypeColor(span.type);

          return (
            <Box
              key={span.spanId}
              position="absolute"
              left={`${left}%`}
              width={`${width}%`}
              minWidth="2px"
              top="4px"
              bottom="4px"
              bg={isError ? "red.solid" : color}
              opacity={0.6}
              borderRadius="xs"
            />
          );
        })}
      </Box>
      <Text textStyle="xs" color="fg.subtle" position="absolute" bottom={1} right={4}>
        Click to expand
      </Text>
    </Flex>
  );
}

/** Whichever visualisation the current tab asks for, once spans have arrived. */
function VizBody({
  isCollapsed,
  isLoading,
  onClearSpan,
  onSelectSpan,
  promptSpanIds,
  selectedSpanId,
  spans,
  vizTab,
}: {
  isCollapsed: boolean;
  isLoading: boolean;
  onClearSpan: () => void;
  onSelectSpan: (spanId: string) => void;
  promptSpanIds: Set<string>;
  selectedSpanId: string | null;
  spans: SpanTreeNode[];
  vizTab: VizTab;
}) {
  if (spans.length === 0) {
    if (isLoading) return <VizSkeleton vizTab={vizTab} />;
    return (
      <Flex align="center" justify="center" height="full">
        <Text textStyle="xs" color="fg.subtle">
          No span data available for this trace
        </Text>
      </Flex>
    );
  }
  if (isCollapsed) return <CollapsedOverview spans={spans} />;
  if (vizTab === "topology" || vizTab === "sequence") {
    return (
      <Suspense fallback={<VizSkeleton vizTab={vizTab} />}>
        <SequenceView
          spans={spans}
          selectedSpanId={selectedSpanId}
          onSelectSpan={onSelectSpan}
          onClearSpan={onClearSpan}
          subMode={vizTab}
        />
      </Suspense>
    );
  }
  if (vizTab === "flame") {
    return (
      <FlameView
        spans={spans}
        selectedSpanId={selectedSpanId}
        onSelectSpan={onSelectSpan}
        onClearSpan={onClearSpan}
        renderShortcutKey={(label) => <Kbd>{label}</Kbd>}
      />
    );
  }

  // Default — waterfall. Any unrecognised vizTab (e.g. a stale URL pointing at
  // the retired "spanlist" tab) falls through here too, so the user gets a
  // usable view rather than a blank pane.
  return (
    <WaterfallView
      spans={spans}
      selectedSpanId={selectedSpanId}
      promptSpanIds={promptSpanIds}
      onSelectSpan={onSelectSpan}
      onClearSpan={onClearSpan}
    />
  );
}
