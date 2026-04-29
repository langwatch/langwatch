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
  useRef,
  useState,
} from "react";
import { FlameView } from "./flameView";
import { SpanListView } from "./spanListView";
import { WaterfallView } from "./waterfallView";
import {
  LuChartGantt,
  LuChevronDown,
  LuChevronUp,
  LuFlame,
  LuGripHorizontal,
  LuList,
  LuMessagesSquare,
  LuMinus,
  LuNetwork,
} from "react-icons/lu";
import { useShallow } from "zustand/react/shallow";
import { Kbd } from "~/components/ops/shared/Kbd";
import { Tooltip } from "~/components/ui/tooltip";
import { PeerCursorOverlay } from "~/features/presence/components/PeerCursorOverlay";
import { PresenceMarker } from "~/features/presence/components/PresenceMarker";
import {
  selectPeersMatching,
  usePresenceStore,
} from "~/features/presence/stores/presenceStore";
import type {
  SpanTreeNode,
  TraceHeader,
} from "~/server/api/routers/tracesV2.schemas";
import type { VizTab } from "../../stores/drawerStore";
import { SPAN_TYPE_COLORS } from "../../utils/formatters";
import { NewSpanFlash } from "./NewSpanFlash";
import { SequenceSkeleton, TopologySkeleton } from "./sequenceView";

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
  onSwitchToSpanList?: (nameFilter: string, typeFilter: string) => void;
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

const TABS: {
  value: VizTab;
  label: string;
  icon: typeof LuChartGantt;
  shortcut: string;
  palette: string;
  description: string;
}[] = [
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
      "Stacked depth-first view showing where time is spent — best for spotting hotspots and deep call stacks.",
  },
  {
    value: "spanlist",
    label: "Span List",
    icon: LuList,
    shortcut: "3",
    palette: "cyan",
    description:
      "Flat, sortable list of every span with type, duration, and tokens — best for searching and filtering.",
  },
  {
    value: "topology",
    label: "Topology",
    icon: LuNetwork,
    shortcut: "4",
    palette: "purple",
    description:
      "Service/agent graph showing what calls what — best for understanding system structure at a glance.",
  },
  {
    value: "sequence",
    label: "Sequence",
    icon: LuMessagesSquare,
    shortcut: "5",
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
  onSwitchToSpanList,
}: VizPlaceholderProps) {
  const [height, setHeight] = useState(getStoredHeight);
  const [spanListSearch, setSpanListSearch] = useState("");
  const [spanListTypeFilter, setSpanListTypeFilter] = useState<
    string | undefined
  >();
  const isDragging = useRef(false);
  const dragStartY = useRef(0);
  const dragStartHeight = useRef(0);

  // Click-to-interact: viz panels capture wheel/drag events that would
  // otherwise scroll the drawer body. Same pattern as IOViewer — overlay
  // sits on top until the user opts in by clicking; clicking outside the
  // viz disengages it. Switching tabs resets engagement.
  const [vizEngaged, setVizEngaged] = useState(false);
  const vizEngagedRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setVizEngaged(false);
  }, [vizTab]);
  useEffect(() => {
    if (!vizEngaged) return;
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target || !vizEngagedRef.current) return;
      if (vizEngagedRef.current.contains(target)) return;
      setVizEngaged(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [vizEngaged]);
  const containerRef = useRef<HTMLDivElement>(null);

  const isMinimized = height === 0;
  const isCollapsed = !isMinimized && height <= MIN_HEIGHT + 20;

  const persistHeight = useCallback((h: number) => {
    localStorage.setItem(STORAGE_KEY, String(h));
  }, []);

  // When span data arrives but the user previously minimized the panel,
  // restore the default height so the visualisation is always visible
  // alongside the chrome — the panel is the primary affordance for the
  // viz, not an opt-in surface.
  const hasData = spans.length > 0;
  useEffect(() => {
    if (hasData && height === 0) {
      setHeight(DEFAULT_HEIGHT);
      persistHeight(DEFAULT_HEIGHT);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasData]);

  // Handle cross-view navigation: waterfall group → span list
  const handleSwitchToSpanList = useCallback(
    (nameFilter: string, typeFilter: string) => {
      setSpanListSearch(nameFilter);
      setSpanListTypeFilter(typeFilter);
      onVizTabChange("spanlist");
      onSwitchToSpanList?.(nameFilter, typeFilter);
    },
    [onVizTabChange, onSwitchToSpanList],
  );

  // Clear span list filters when switching away from span list
  const handleVizTabChange = useCallback(
    (tab: VizTab) => {
      if (tab !== "spanlist") {
        setSpanListSearch("");
        setSpanListTypeFilter(undefined);
      }
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
    <Box ref={containerRef}>
      <Box overflow="hidden" bg="bg.panel">
        {/* Tab bar */}
        <Flex
          align="center"
          justify="space-between"
          paddingX={3}
          paddingY={1.5}
          borderBottomWidth={isMinimized ? "0px" : "1px"}
          borderColor="border.subtle"
          bg="bg.subtle/40"
        >
          <HStack gap={0.5}>
            {TABS.map((tab) => {
              const isActive = vizTab === tab.value;
              return (
                <Tooltip
                  key={tab.value}
                  content={tab.description}
                  positioning={{ placement: "top" }}
                  openDelay={400}
                >
                  <Flex
                    as="button"
                    align="center"
                    gap={1.5}
                    paddingX={2.5}
                    paddingY={1}
                    borderRadius="md"
                    cursor="pointer"
                    bg={isActive ? `${tab.palette}.subtle` : "transparent"}
                    color={`${tab.palette}.fg`}
                    _hover={{
                      bg: isActive
                        ? `${tab.palette}.subtle`
                        : `${tab.palette}.subtle/40`,
                    }}
                    _active={{ transform: "scale(0.96)" }}
                    transition="background 0.15s ease, transform 0.1s ease"
                    onClick={() => handleVizTabChange(tab.value)}
                    fontWeight="medium"
                  >
                    <Icon as={tab.icon} boxSize={3.5} />
                    <Text textStyle="xs" lineHeight={1}>
                      {tab.label}
                    </Text>
                    <Kbd>{tab.shortcut}</Kbd>
                    {trace ? (
                      <VizTabPresenceDot
                        traceId={trace.traceId}
                        panel={tab.value}
                      />
                    ) : null}
                  </Flex>
                </Tooltip>
              );
            })}
          </HStack>

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
        </Flex>

        {/* Visualization content */}
        {!isMinimized && (
          <Box
            ref={vizEngagedRef}
            height={`${height}px`}
            overflow="hidden"
            transition={isDragging.current ? "none" : "height 0.2s ease"}
            onClick={isCollapsed ? handleExpandFromCollapsed : undefined}
            cursor={isCollapsed ? "pointer" : "default"}
            position="relative"
          >
            <NewSpanFlash
              spanCount={spans.length}
              resetKey={trace?.traceId ?? null}
            />
            <PeerCursorOverlay
              anchor={trace ? `trace:${trace.traceId}:panel:${vizTab}` : null}
              enabled={!!trace && !isCollapsed}
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
              ) : vizTab === "waterfall" ? (
                <WaterfallView
                  spans={spans}
                  selectedSpanId={selectedSpanId}
                  onSelectSpan={onSelectSpan}
                  onClearSpan={onClearSpan}
                  onSwitchToSpanList={handleSwitchToSpanList}
                />
              ) : vizTab === "flame" ? (
                <FlameView
                  spans={spans}
                  selectedSpanId={selectedSpanId}
                  onSelectSpan={onSelectSpan}
                  onClearSpan={onClearSpan}
                />
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
              ) : (
                <SpanListView
                  spans={spans}
                  selectedSpanId={selectedSpanId}
                  onSelectSpan={onSelectSpan}
                  onClearSpan={onClearSpan}
                  initialSearch={spanListSearch}
                  initialTypeFilter={spanListTypeFilter}
                />
              )}
            </PeerCursorOverlay>
            {!isCollapsed && !vizEngaged && spans.length > 0 && !isLoading && (
              <Box
                position="absolute"
                inset={0}
                cursor="zoom-in"
                onClick={() => setVizEngaged(true)}
                display="flex"
                alignItems="flex-end"
                justifyContent="center"
                paddingBottom={2}
                background="linear-gradient(to bottom, transparent 70%, var(--chakra-colors-bg-subtle) 100%)"
                zIndex={5}
              >
                <Text
                  textStyle="2xs"
                  color="fg.muted"
                  fontWeight="medium"
                  bg="bg.surface"
                  paddingX={2}
                  paddingY={0.5}
                  borderRadius="full"
                  borderWidth="1px"
                  borderColor="border"
                >
                  Click to interact
                </Text>
              </Box>
            )}
          </Box>
        )}

        {/* Resize handle */}
        {!isMinimized && (
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
  if (vizTab === "flame") return <FlameSkeleton />;
  if (vizTab === "spanlist") return <SpanListSkeleton />;
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

const FLAME_STRIPS = [
  [{ left: 0, width: 100 }],
  [
    { left: 0, width: 38 },
    { left: 40, width: 24 },
    { left: 66, width: 32 },
  ],
  [
    { left: 2, width: 16 },
    { left: 22, width: 14 },
    { left: 42, width: 20 },
    { left: 68, width: 28 },
  ],
  [
    { left: 4, width: 10 },
    { left: 46, width: 12 },
    { left: 70, width: 8 },
    { left: 82, width: 12 },
  ],
] as const;

function FlameSkeleton() {
  return (
    <VStack
      align="stretch"
      gap="2px"
      paddingX={3}
      paddingY={3}
      height="full"
    >
      {FLAME_STRIPS.map((strip, depth) => (
        <Box key={depth} position="relative" height="22px">
          {strip.map((seg, i) => (
            <Skeleton
              key={i}
              position="absolute"
              top={0}
              left={`${seg.left}%`}
              width={`${seg.width}%`}
              height="full"
              borderRadius="sm"
            />
          ))}
        </Box>
      ))}
    </VStack>
  );
}

function SpanListSkeleton() {
  // Minimal: one horizontal bar per row, consistent rhythm. Chakra's
  // <Skeleton> handles the shimmer.
  const ROW_WIDTHS = [86, 64, 78, 52, 70, 90, 60, 74, 48, 82];
  return (
    <VStack align="stretch" gap={0} height="full" paddingY={2}>
      {ROW_WIDTHS.map((w, i) => (
        <Flex key={i} paddingX={4} paddingY={1.5}>
          <Skeleton height="12px" width={`${w}%`} borderRadius="sm" />
        </Flex>
      ))}
    </VStack>
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
