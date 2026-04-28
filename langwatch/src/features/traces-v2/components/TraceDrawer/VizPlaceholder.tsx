import { Box, Flex, HStack, Icon, Text, VStack } from "@chakra-ui/react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  LuChartGantt,
  LuChevronDown,
  LuChevronUp,
  LuFlame,
  LuGripHorizontal,
  LuList,
  LuMessagesSquare,
  LuMinus,
} from "react-icons/lu";
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

// Each viz lives in its own chunk so the trace drawer's initial JS payload
// stays small. Only the active tab's chunk is downloaded — and React only
// mounts the active viz, so non-active ones cost nothing at runtime either.
const WaterfallView = lazy(() =>
  import("./waterfallView").then((m) => ({ default: m.WaterfallView })),
);
const FlameView = lazy(() =>
  import("./flameView").then((m) => ({ default: m.FlameView })),
);
const SpanListView = lazy(() =>
  import("./spanListView").then((m) => ({ default: m.SpanListView })),
);
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
const VIZ_TAB_STORAGE_KEY = "langwatch:traces-v2:viz-tab";

function VizTabPresenceDot({
  traceId,
  panel,
}: {
  traceId: string;
  panel: VizTab;
}) {
  const peers = usePresenceStore((s) =>
    selectPeersMatching(
      s,
      (session) =>
        session.location.route.traceId === traceId &&
        session.location.view?.panel === panel,
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
}[] = [
  { value: "waterfall", label: "Waterfall", icon: LuChartGantt, shortcut: "1" },
  { value: "flame", label: "Flame", icon: LuFlame, shortcut: "2" },
  { value: "spanlist", label: "Span List", icon: LuList, shortcut: "3" },
  {
    value: "sequence",
    label: "Sequence",
    icon: LuMessagesSquare,
    shortcut: "4",
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

  // Persist viz tab preference
  useEffect(() => {
    localStorage.setItem(VIZ_TAB_STORAGE_KEY, vizTab);
  }, [vizTab]);

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
                  content={tab.label}
                  positioning={{ placement: "top" }}
                >
                  <Flex
                    as="button"
                    align="center"
                    gap={1.5}
                    paddingX={2.5}
                    paddingY={1}
                    borderRadius="md"
                    cursor="pointer"
                    bg={isActive ? "bg.emphasized" : "transparent"}
                    color={isActive ? "fg" : "fg.muted"}
                    _hover={{
                      bg: isActive ? "bg.emphasized" : "bg.muted",
                      color: "fg",
                    }}
                    transition="background 0.15s ease, color 0.15s ease"
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
              ) : (
                <Suspense fallback={<VizSkeleton vizTab={vizTab} />}>
                  {vizTab === "waterfall" ? (
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
                  ) : vizTab === "sequence" ? (
                    <SequenceView
                      spans={spans}
                      selectedSpanId={selectedSpanId}
                      onSelectSpan={onSelectSpan}
                      onClearSpan={onClearSpan}
                    />
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
                </Suspense>
              )}
            </PeerCursorOverlay>
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

const PULSE_KEYFRAMES = {
  "@keyframes vizPulse": {
    "0%, 100%": { opacity: 0.55 },
    "50%": { opacity: 0.85 },
  },
} as const;

/**
 * Loading skeleton dispatched by the active viz tab. Each variant mimics
 * the shape of the real view so the user's eye doesn't have to re-anchor
 * when data lands — waterfall rows stay where waterfall rows will be,
 * flame strips at flame depths, span list as a table.
 */
function VizSkeleton({ vizTab }: { vizTab?: VizTab }) {
  if (vizTab === "flame") return <FlameSkeleton />;
  if (vizTab === "spanlist") return <SpanListSkeleton />;
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
    <Flex direction="row" height="full" css={PULSE_KEYFRAMES}>
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
            <Box
              width="8px"
              height="8px"
              borderRadius="full"
              bg="bg.muted"
              flexShrink={0}
              css={{
                animation: `vizPulse 1.4s ease-in-out ${i * 0.08}s infinite`,
              }}
            />
            <Box
              height="8px"
              borderRadius="sm"
              bg="bg.muted"
              flex={1}
              css={{
                animation: `vizPulse 1.4s ease-in-out ${i * 0.08}s infinite`,
              }}
            />
          </Flex>
        ))}
      </VStack>
      <VStack align="stretch" gap={1.5} flex={0.6} paddingX={3} paddingY={3}>
        {WATERFALL_ROWS.map((row, i) => (
          <Flex key={i} height="14px" align="center" position="relative">
            <Box
              position="absolute"
              left={`${row.barLeft}%`}
              width={`${row.barWidth}%`}
              height="10px"
              borderRadius="sm"
              bg="blue.muted"
              css={{
                animation: `vizPulse 1.4s ease-in-out ${i * 0.08}s infinite`,
              }}
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
      css={PULSE_KEYFRAMES}
    >
      {FLAME_STRIPS.map((strip, depth) => (
        <Box key={depth} position="relative" height="22px">
          {strip.map((seg, i) => (
            <Box
              key={i}
              position="absolute"
              top={0}
              left={`${seg.left}%`}
              width={`${seg.width}%`}
              height="full"
              borderRadius="sm"
              bg={depth === 0 ? "purple.muted" : "blue.muted"}
              css={{
                animation: `vizPulse 1.4s ease-in-out ${(depth + i) * 0.08}s infinite`,
              }}
            />
          ))}
        </Box>
      ))}
    </VStack>
  );
}

function SpanListSkeleton() {
  return (
    <VStack align="stretch" gap={0} height="full" css={PULSE_KEYFRAMES}>
      <Flex
        gap={3}
        paddingX={3}
        paddingY={2}
        borderBottomWidth="1px"
        borderColor="border.subtle"
        bg="bg.subtle/30"
      >
        {[16, 24, 12, 18, 14].map((width, i) => (
          <Box
            key={i}
            height="8px"
            width={`${width}%`}
            borderRadius="sm"
            bg="bg.muted"
            css={{
              animation: `vizPulse 1.4s ease-in-out ${i * 0.06}s infinite`,
            }}
          />
        ))}
      </Flex>
      {Array.from({ length: 9 }).map((_, i) => (
        <Flex
          key={i}
          gap={3}
          paddingX={3}
          paddingY={2}
          borderBottomWidth="1px"
          borderColor="border.subtle"
        >
          {[18, 22, 12, 16, 12].map((width, j) => (
            <Box
              key={j}
              height="10px"
              width={`${width}%`}
              borderRadius="sm"
              bg="bg.muted"
              css={{
                animation: `vizPulse 1.4s ease-in-out ${(i + j) * 0.05}s infinite`,
              }}
            />
          ))}
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
