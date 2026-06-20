import {
  Box,
  Flex,
  HStack,
  Icon,
  Skeleton,
  Text,
  VStack,
} from "@chakra-ui/react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
import { Kbd } from "~/components/ops/shared/Kbd";
import { Tooltip } from "~/components/ui/tooltip";
// PeerCursorOverlay used to wrap just the viz pane (scoped to the
// active viz tab). It was lifted to the drawer level (TraceDrawerShell)
// so cursors render anywhere a peer's cursor lands in the drawer — the
// previous scope hid peers as soon as they hovered out of the
// viz pane.
import { PresenceMarker } from "~/features/presence/components/PresenceMarker";
import {
  selectPeersMatching,
  usePresenceStore,
} from "~/features/presence/stores/presenceStore";
import type {
  SpanTreeNode,
  TraceHeader,
} from "~/server/api/routers/tracesV2.schemas";
import { useOverflowVisibility } from "../../hooks/useOverflowVisibility";
import { useDrawerStore, type VizTab } from "../../stores/drawerStore";
import { SPAN_TYPE_COLORS } from "../../utils/formatters";
import { OverflowMenu } from "../shared/OverflowMenu";
import { FlameView } from "./flameView/FlameView";
import { SequenceSkeleton } from "./sequenceView/SequenceSkeleton";
import { TopologySkeleton } from "./sequenceView/TopologySkeleton";
import { WaterfallView } from "./waterfallView";

// SequenceView pulls in `mermaid` (~1MB+ — d3, dagre, several parsers).
// That's the only viz heavy enough to keep code-split — the others are
// statically imported so tab switches stay synchronous.
const SequenceView = lazy(() =>
  import("./sequenceView").then((m) => ({ default: m.SequenceView })),
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
   * When true, the viz fills its parent's full height — the internal
   * height state and the bottom resize handle are skipped because the
   * parent (`<PanelGroup>` from `react-resizable-panels`) owns sizing.
   * Used by the new pane layout where every section is its own
   * independently sized panel.
   */
  fillParent?: boolean;
  /**
   * Layout orientation of the parent pane group. Drives which icon the
   * "show details" affordance uses when the detail pane is collapsed —
   * right-pointing for a side-by-side split, top/bottom for stacked.
   */
  paneLayout?: "horizontal" | "vertical";
}

const MIN_HEIGHT = 80;
const DEFAULT_HEIGHT = 250;
const EXPANDED_HEIGHT = 480;
const MAX_HEIGHT = 700;
const STORAGE_KEY = "langwatch:traces-v2:viz-height";

function VizTabPresenceDot({
  traceId,
  panel,
}: {
  traceId: string;
  panel: VizTab;
}) {
  const peers = usePresenceStore(
    useShallow((s) =>
      selectPeersMatching(
        s,
        (session) =>
          session.location.route.traceId === traceId &&
          session.location.view?.panel === panel,
      ),
    ),
  );
  if (peers.length === 0) return null;
  return (
    <PresenceMarker peers={peers} size={16} tooltipSuffix={`${panel} panel`} />
  );
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
 * Shared icon + label + shortcut + presence-dot row used by both the
 * in-row tab AND the overflow menu's dropdown entries. Keeping this in
 * one place avoids the dropdown losing the icon / kbd hint when a tab
 * is folded out of sight — the user sees the same affordance either
 * way.
 */
function VizTabContent({
  tab,
  traceId,
}: {
  tab: VizTabDef;
  traceId: string | null;
}) {
  return (
    <>
      <Icon as={tab.icon} boxSize={3.5} />
      <Text textStyle="xs" lineHeight={1}>
        {tab.label}
      </Text>
      <Kbd>{tab.shortcut}</Kbd>
      {traceId ? (
        <VizTabPresenceDot traceId={traceId} panel={tab.value} />
      ) : null}
    </>
  );
}

// The viz strip ships four tabs as of Round 3. Span List stays retired —
// it added filter chrome but no fundamentally new data axis, and the
// waterfall + sidebar filter together cover the same workflow. Flame
// was retired alongside it but brought back because the time-weighted
// block layout reads completely differently from the indented waterfall
// when scanning hot paths: waterfall makes parent/child easy, flame
// makes "where time goes" obvious. Sequence + Topology cover
// specialised flows the waterfall can't render natively. Flame sits
// right after Waterfall so the two timing views read as a pair before
// the structural views.
const TABS: VizTabDef[] = [
  {
    value: "waterfall",
    label: "Waterfall",
    icon: LuChartGantt,
    shortcut: "1",
    palette: "blue",
    description:
      "Spans laid out by start time with parent/child indentation — best for tracing causality top-down.",
  },
  {
    value: "flame",
    label: "Flame",
    icon: LuFlame,
    shortcut: "2",
    palette: "orange",
    description:
      "Spans laid out by depth with width proportional to duration — best for spotting hot paths and time-skewed children.",
  },
  {
    value: "topology",
    label: "Topology",
    icon: LuNetwork,
    shortcut: "3",
    palette: "purple",
    description:
      "Service/agent graph showing what calls what — best for understanding system structure at a glance.",
  },
  {
    value: "sequence",
    label: "Sequence",
    icon: LuMessagesSquare,
    shortcut: "4",
    palette: "teal",
    description:
      "Chat-style turn order between actors — best for replaying multi-agent conversations.",
  },
];

function getStoredHeight(): number {
  if (typeof window === "undefined") return DEFAULT_HEIGHT;
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return DEFAULT_HEIGHT;
  const parsed = parseInt(stored, 10);
  if (Number.isNaN(parsed)) return DEFAULT_HEIGHT;
  if (parsed === 0) return 0;
  if (parsed >= MIN_HEIGHT && parsed <= MAX_HEIGHT) return parsed;
  return DEFAULT_HEIGHT;
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
  const promptSpanIds = useMemo(() => {
    const ids = new Set<string>();
    if (trace?.selectedPromptSpanId) ids.add(trace.selectedPromptSpanId);
    if (trace?.lastUsedPromptSpanId) ids.add(trace.lastUsedPromptSpanId);
    return ids;
  }, [trace?.selectedPromptSpanId, trace?.lastUsedPromptSpanId]);

  // When the detail pane is hidden, surface a "Show details" affordance
  // in the viz tab row so the user can bring it back without having to
  // click a span. The detail pane also auto-reopens whenever a span is
  // selected (see `drawerStore.selectSpan`); this is the manual escape
  // for when the user wants to see the trace summary again.
  const detailCollapsed = useDrawerStore(
    (s) => s.paneState.spanDetail.collapsed,
  );
  const togglePaneCollapsed = useDrawerStore((s) => s.togglePaneCollapsed);

  // Overflow detection for the viz tab row — when the container is
  // narrow enough that some tabs would clip, they get folded into a
  // single overflow menu rendered after the visible tabs.
  const tabScrollerRef = useRef<HTMLDivElement>(null);
  const tabIds = useMemo(() => TABS.map((t) => t.value), []);
  const hiddenTabIds = useOverflowVisibility({
    scrollerRef: tabScrollerRef,
    items: tabIds,
    activeId: vizTab,
    // Just enough headroom to fit the overflow trigger (~22px). The
    // earlier 40px reserve was over-aggressive: tabs that visibly fit
    // were still being folded into the menu because we were holding back
    // a much larger margin than the trigger actually needs.
    reservePx: 26,
  });

  const [height, setHeight] = useState(getStoredHeight);
  const isDragging = useRef(false);
  const dragStartY = useRef(0);
  const dragStartHeight = useRef(0);

  // The previous "Click to interact" scrim is gone — the new pane
  // layout (TraceDrawerShell + react-resizable-panels) gives each viz
  // its own scroll container, so wheel events naturally scope to the
  // pane the cursor is over. No need for an opt-in overlay.
  const vizEngagedRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // In fillParent mode the parent <Panel> owns sizing, so the local
  // minimize/collapse states are irrelevant — the viz simply fills the
  // available space. We coerce them to false so all the conditional
  // rendering below behaves as if the panel were at its normal height.
  const isMinimized = fillParent ? false : height === 0;
  const isCollapsed = fillParent
    ? false
    : !isMinimized && height <= MIN_HEIGHT + 20;

  const persistHeight = useCallback((h: number) => {
    localStorage.setItem(STORAGE_KEY, String(h));
  }, []);

  // When span data arrives but the user previously minimized the panel,
  // restore the default height so the visualisation is always visible
  // alongside the chrome — the panel is the primary affordance for the
  // viz, not an opt-in surface.
  const hasData = spans.length > 0;
  useEffect(() => {
    // In fillParent mode the parent <Panel> owns sizing — touching the
    // local height (and persisting it) would silently clobber the
    // user's preference for the next standalone (non-pane) render.
    if (fillParent) return;
    if (hasData && height === 0) {
      setHeight(DEFAULT_HEIGHT);
      persistHeight(DEFAULT_HEIGHT);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasData, fillParent]);

  const handleVizTabChange = useCallback(
    (tab: VizTab) => {
      // Span list filter state had its own scoped reset here. With the
      // tab removed there's nothing to reset; just forward.
      onVizTabChange(tab);
    },
    [onVizTabChange],
  );

  const handleCycleSize = useCallback(() => {
    setHeight((prev) => {
      let next: number;
      if (prev === 0) {
        next = DEFAULT_HEIGHT;
      } else if (prev < EXPANDED_HEIGHT) {
        next = EXPANDED_HEIGHT;
      } else {
        next = 0;
      }
      persistHeight(next);
      return next;
    });
  }, [persistHeight]);

  const handleExpandFromCollapsed = useCallback(() => {
    if (isCollapsed || isMinimized) {
      setHeight(DEFAULT_HEIGHT);
      persistHeight(DEFAULT_HEIGHT);
    }
  }, [isCollapsed, isMinimized, persistHeight]);

  // Resize handle drag
  const handleResizeStart = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      e.preventDefault();
      isDragging.current = true;
      dragStartY.current = "touches" in e ? e.touches[0]!.clientY : e.clientY;
      dragStartHeight.current = height;
      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";
    },
    [height],
  );

  useEffect(() => {
    const handleMove = (e: MouseEvent | TouchEvent) => {
      if (!isDragging.current) return;
      const clientY = "touches" in e ? e.touches[0]!.clientY : e.clientY;
      const delta = clientY - dragStartY.current;
      const raw = dragStartHeight.current + delta;
      const next =
        raw < MIN_HEIGHT / 2
          ? 0
          : Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, raw));
      setHeight(next);
    };

    const handleEnd = () => {
      if (!isDragging.current) return;
      isDragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      persistHeight(height);
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleEnd);
    window.addEventListener("touchmove", handleMove);
    window.addEventListener("touchend", handleEnd);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleEnd);
      window.removeEventListener("touchmove", handleMove);
      window.removeEventListener("touchend", handleEnd);
    };
  }, [height, persistHeight]);

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
          borderBottomWidth={isMinimized ? "0px" : "1px"}
          borderColor="border"
          bg={{ base: "bg.surface", _dark: "bg.panel" }}
          flexShrink={0}
          minHeight="38px"
          data-spotlight="viz-tabs"
        >
          <HStack
            ref={tabScrollerRef}
            gap={0}
            overflowX="hidden"
            flexWrap="nowrap"
            flex="1"
            minWidth={0}
          >
            {TABS.map((tab) => {
              const isActive = vizTab === tab.value;
              const isHidden = hiddenTabIds.has(tab.value);
              return (
                <Tooltip
                  key={tab.value}
                  content={tab.description}
                  positioning={{ placement: "top" }}
                  openDelay={400}
                >
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
                    // Light mode: inactive tabs render in neutral grey so
                    // the strip doesn't read as a wall of saturated
                    // colour against the otherwise muted light surface.
                    // Dark mode: keep the palette colour — against the
                    // darker background the palette tones read as a
                    // helpful colour-coded picker.
                    color={
                      isActive
                        ? `${tab.palette}.fg`
                        : { base: "fg.muted", _dark: `${tab.palette}.fg` }
                    }
                    bg={isActive ? `${tab.palette}.subtle` : "transparent"}
                    flexShrink={0}
                    whiteSpace="nowrap"
                    display={isHidden ? "none" : "flex"}
                    _hover={{
                      bg: isActive ? `${tab.palette}.subtle` : "bg.muted",
                    }}
                    transition="background 0.15s ease"
                    onClick={() => handleVizTabChange(tab.value)}
                    fontWeight={isActive ? "600" : "500"}
                  >
                    <VizTabContent tab={tab} traceId={trace?.traceId ?? null} />
                  </Flex>
                </Tooltip>
              );
            })}
            {/* Spacer pushes the overflow trigger to the far right of
                the tab row so it doesn't glue to the last visible tab.
                Reads as "kebab menu = tab-row controls", not "kebab menu
                = appendix to the rightmost tab". */}
            <Box flex={1} minWidth={0} />
            <OverflowMenu
              items={TABS.filter((t) => hiddenTabIds.has(t.value)).map((t) => ({
                id: t.value,
                label: t.label,
                // Mirror the in-row tab rendering so the dropdown row
                // carries the same icon + label + shortcut + presence
                // dot the user would have seen on the tab itself.
                content: (
                  <HStack gap={1.5} flex={1} color={`${t.palette}.fg`}>
                    <VizTabContent tab={t} traceId={trace?.traceId ?? null} />
                  </HStack>
                ),
              }))}
              activeId={vizTab}
              onSelect={(id) => handleVizTabChange(id as VizTab)}
              ariaLabel="Show more viz tabs"
            />
          </HStack>

          {!fillParent && (
            <HStack gap={1.5}>
              <Tooltip
                content={
                  isMinimized
                    ? "Show"
                    : height >= EXPANDED_HEIGHT
                      ? "Minimize"
                      : "Expand"
                }
                positioning={{ placement: "top" }}
              >
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
                  onClick={handleCycleSize}
                >
                  <Icon
                    as={
                      isMinimized
                        ? LuChevronDown
                        : height >= EXPANDED_HEIGHT
                          ? LuMinus
                          : LuChevronUp
                    }
                    boxSize={3.5}
                  />
                </Flex>
              </Tooltip>
            </HStack>
          )}
          {fillParent && detailCollapsed && (
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
                // When the detail pane is collapsed-to-zero against
                // the resize handle on this edge, the handle's 6px
                // hit-zone overlay (`z-index: 2` in PaneResizeBar)
                // sits on top of this button. Without an explicit
                // `position` + higher `z-index`, the overlay wins:
                // cursor reads as col-resize and clicks land on the
                // (no-op) resize, leaving the operator stuck. The
                // overlay is intentionally still there so a mid-drag
                // "oops, too far" can be undone by dragging back.
                position="relative"
                zIndex={3}
                aria-label="Show details"
                onClick={() => togglePaneCollapsed("spanDetail")}
              >
                <Icon
                  as={
                    paneLayout === "horizontal"
                      ? LuPanelRightOpen
                      : LuPanelBottomOpen
                  }
                  boxSize={3.5}
                />
              </Flex>
            </Tooltip>
          )}
        </Flex>

        {/* Visualization content */}
        {!isMinimized && (
          <Box
            ref={vizEngagedRef}
            height={fillParent ? undefined : `${height}px`}
            flex={fillParent ? 1 : undefined}
            minHeight={0}
            overflow={fillParent ? "auto" : "hidden"}
            transition={
              fillParent
                ? undefined
                : isDragging.current
                  ? "none"
                  : "height 0.2s ease"
            }
            onClick={isCollapsed ? handleExpandFromCollapsed : undefined}
            cursor={isCollapsed ? "pointer" : "default"}
            position="relative"
            style={fillParent ? { overflowAnchor: "none" } : undefined}
          >
            {isLoading && spans.length === 0 ? (
              <VizSkeleton vizTab={vizTab} />
            ) : spans.length === 0 ? (
              <Flex align="center" justify="center" height="full">
                <Text textStyle="xs" color="fg.subtle">
                  No span data available for this trace
                </Text>
              </Flex>
            ) : isCollapsed ? (
              <CollapsedOverview spans={spans} />
            ) : vizTab === "topology" || vizTab === "sequence" ? (
              <Suspense fallback={<VizSkeleton vizTab={vizTab} />}>
                <SequenceView
                  spans={spans}
                  selectedSpanId={selectedSpanId}
                  onSelectSpan={onSelectSpan}
                  onClearSpan={onClearSpan}
                  subMode={vizTab}
                />
              </Suspense>
            ) : vizTab === "flame" ? (
              <FlameView
                spans={spans}
                selectedSpanId={selectedSpanId}
                onSelectSpan={onSelectSpan}
                onClearSpan={onClearSpan}
              />
            ) : (
              // Default — waterfall. Any unrecognised vizTab (e.g. a
              // stale URL pointing at the retired "spanlist" tab) falls
              // through here too so the user gets a usable view rather
              // than a blank pane.
              <WaterfallView
                spans={spans}
                selectedSpanId={selectedSpanId}
                promptSpanIds={promptSpanIds}
                onSelectSpan={onSelectSpan}
                onClearSpan={onClearSpan}
              />
            )}
            {/*
              The "Click to interact" scrim used to sit here. With the
              pane layout giving each viz its own scroll container, the
              overlay is redundant — wheel events scope to the pane the
              cursor is over and never bleed into the drawer body.
            */}
          </Box>
        )}

        {/* Resize handle — only in stand-alone (legacy) mode; the new
            pane layout uses <PanelResizeHandle> instead. */}
        {!fillParent && !isMinimized && (
          <Flex
            align="center"
            justify="center"
            height="12px"
            cursor="row-resize"
            color="fg.subtle"
            _hover={{ color: "fg.muted", bg: "bg.subtle/60" }}
            transition="all 0.15s ease"
            onMouseDown={handleResizeStart}
            onTouchStart={handleResizeStart}
            userSelect="none"
            flexShrink={0}
          >
            <Icon as={LuGripHorizontal} boxSize={3.5} />
          </Flex>
        )}
      </Box>
    </Box>
  );
}

// Each skeleton block uses Chakra's <Skeleton> which already provides the
// built-in shimmer animation. No custom keyframes needed — every block in
// every viz skeleton inherits the same loading shimmer for a consistent
// feel.

/**
 * Loading skeleton dispatched by the active viz tab. Each variant mimics
 * the shape of the real view so the user's eye doesn't have to re-anchor
 * when data lands — waterfall rows stay where waterfall rows will be,
 * flame strips at flame depths, span list as a table.
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
    <Flex
      align="center"
      height="full"
      paddingX={4}
      paddingY={2}
      gap={0}
      position="relative"
    >
      <Box
        width="full"
        height="32px"
        position="relative"
        borderRadius="md"
        overflow="hidden"
      >
        {spans.map((span) => {
          const left = ((span.startTimeMs - minStart) / totalDuration) * 100;
          const width = Math.max(
            0.5,
            ((span.endTimeMs - span.startTimeMs) / totalDuration) * 100,
          );
          const isError = span.status === "error";
          const color =
            (SPAN_TYPE_COLORS[span.type ?? "span"] as string) ?? "gray.solid";

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
      <Text
        textStyle="xs"
        color="fg.subtle"
        position="absolute"
        bottom={1}
        right={4}
      >
        Click to expand
      </Text>
    </Flex>
  );
}
