import {
  Box,
  Flex,
  HStack,
  Icon,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LuChevronDown,
  LuChevronUp,
  LuFlame,
  LuGripHorizontal,
  LuList,
  LuMinus,
  LuChartGantt,
} from "react-icons/lu";
import { Tooltip } from "~/components/ui/tooltip";
import { Kbd } from "~/components/ops/shared/Kbd";
import { PresenceMarker } from "~/features/presence/components/PresenceMarker";
import { PeerCursorOverlay } from "~/features/presence/components/PeerCursorOverlay";
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
import { WaterfallView } from "./WaterfallView";
import { FlameView } from "./FlameView";
import { NewSpanFlash } from "./NewSpanFlash";
import { SpanListView } from "./SpanListView";

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
  return <PresenceMarker peers={peers} size={16} tooltipSuffix={`${panel} panel`} />;
}

const TABS: { value: VizTab; label: string; icon: typeof LuChartGantt; shortcut: string }[] = [
  { value: "waterfall", label: "Waterfall", icon: LuChartGantt, shortcut: "1" },
  { value: "flame", label: "Flame", icon: LuFlame, shortcut: "2" },
  { value: "spanlist", label: "Span List", icon: LuList, shortcut: "3" },
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
  const [spanListTypeFilter, setSpanListTypeFilter] = useState<string | undefined>();
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
  const handleSwitchToSpanList = useCallback((nameFilter: string, typeFilter: string) => {
    setSpanListSearch(nameFilter);
    setSpanListTypeFilter(typeFilter);
    onVizTabChange("spanlist");
    onSwitchToSpanList?.(nameFilter, typeFilter);
  }, [onVizTabChange, onSwitchToSpanList]);

  // Clear span list filters when switching away from span list
  const handleVizTabChange = useCallback((tab: VizTab) => {
    if (tab !== "spanlist") {
      setSpanListSearch("");
      setSpanListTypeFilter(undefined);
    }
    onVizTabChange(tab);
  }, [onVizTabChange]);

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
      const next = raw < MIN_HEIGHT / 2
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
          <NewSpanFlash spanCount={spans.length} resetKey={trace?.traceId ?? null} />
          <PeerCursorOverlay
            anchor={trace ? `trace:${trace.traceId}:panel:${vizTab}` : null}
            enabled={!!trace && !isCollapsed}
          >
          {isLoading && spans.length === 0 ? (
            <VizSkeleton />
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

const SKELETON_ROWS = [
  { left: 4, width: 92 },
  { left: 8, width: 58 },
  { left: 14, width: 36 },
  { left: 22, width: 44 },
  { left: 12, width: 70 },
  { left: 6, width: 30 },
  { left: 50, width: 26 },
  { left: 24, width: 60 },
] as const;

function VizSkeleton() {
  return (
    <VStack
      align="stretch"
      gap={1.5}
      paddingX={4}
      paddingY={3}
      height="full"
      css={{
        "@keyframes vizPulse": {
          "0%, 100%": { opacity: 0.55 },
          "50%": { opacity: 0.85 },
        },
      }}
    >
      {SKELETON_ROWS.map((row, i) => (
        <Flex key={i} height="14px" align="center">
          <Box
            height="full"
            borderRadius="sm"
            bg="bg.muted"
            marginLeft={`${row.left}%`}
            width={`${row.width}%`}
            css={{
              animation: `vizPulse 1.4s ease-in-out ${i * 0.08}s infinite`,
            }}
          />
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
      <Box width="full" height="32px" position="relative" borderRadius="md" overflow="hidden">
        {spans.map((span) => {
          const left = ((span.startTimeMs - minStart) / totalDuration) * 100;
          const width = Math.max(
            0.5,
            ((span.endTimeMs - span.startTimeMs) / totalDuration) * 100,
          );
          const isError = span.status === "error";
          const color = (SPAN_TYPE_COLORS[span.type ?? "span"] as string) ?? "gray.solid";

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
