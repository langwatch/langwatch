import { useState, useCallback, useRef, useMemo } from "react";
import { Box, Text, HStack } from "@chakra-ui/react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceArea,
} from "recharts";
import type { ThroughputPoint } from "../../../shared/types.ts";

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}:${d.getSeconds().toString().padStart(2, "0")}`;
}

/** The shape passed by recharts to mouse handlers on the chart wrapper. */
interface ChartMouseEvent {
  activeLabel?: string | number;
}

const SERIES = [
  { key: "stagedPerSec", label: "Staged/s", color: "#00f0ff", gradientId: "stagedGrad" },
  { key: "completedPerSec", label: "Completed/s", color: "#00ff41", gradientId: "completedGrad" },
  { key: "failedPerSec", label: "Failed/s", color: "#ff0033", gradientId: "failedGrad" },
] as const;

/**
 * Zoom can be anchored:
 * - 'right': the window slides to always show the latest data (tail)
 * - 'left': the window stays pinned to the oldest data (lead)
 * - 'fixed': absolute range, doesn't move
 */
type ZoomAnchor = "left" | "right" | "fixed";

interface ZoomState {
  /** Window width in ms */
  durationMs: number;
  anchor: ZoomAnchor;
  /** Only used when anchor === 'fixed' */
  left: number;
  right: number;
}

/** How close (ms) the drag edge needs to be to data edge to trigger anchoring */
const ANCHOR_TOLERANCE_MS = 30_000;

const TICK_COLOR = "#4a6a7a";

function SeriesLegendToggle({
  series,
  isHidden,
  onToggle,
}: {
  series: (typeof SERIES)[number];
  isHidden: boolean;
  onToggle: () => void;
}) {
  return (
    <HStack
      spacing={1.5}
      cursor="pointer"
      role="button"
      tabIndex={0}
      aria-pressed={!isHidden}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
      opacity={isHidden ? 0.3 : 1}
      transition="opacity 0.15s"
      _hover={{ opacity: isHidden ? 0.5 : 0.8 }}
      _focus={{ outline: "1px solid #00f0ff", outlineOffset: "2px" }}
      _focusVisible={{ outline: "1px solid #00f0ff", outlineOffset: "2px" }}
    >
      <Box w="8px" h="8px" borderRadius="1px" bg={isHidden ? TICK_COLOR : series.color} transition="background 0.15s" />
      <Text
        fontSize="10px"
        color={isHidden ? TICK_COLOR : series.color}
        fontFamily="mono"
        textDecoration={isHidden ? "line-through" : "none"}
        transition="color 0.15s"
      >
        {series.label}
      </Text>
    </HStack>
  );
}

function ResetZoomButton({ onClick }: { onClick: () => void }) {
  return (
    <Box
      as="span"
      fontSize="10px"
      color="#ffc800"
      cursor="pointer"
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e: React.KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      _hover={{ textDecoration: "underline" }}
      _focus={{ outline: "1px solid #ffc800", outlineOffset: "2px" }}
      _focusVisible={{ outline: "1px solid #ffc800", outlineOffset: "2px" }}
      fontFamily="mono"
    >
      RESET ZOOM
    </Box>
  );
}

function ChartHeader({
  zoom,
  anchorLabel,
  hidden,
  onToggleSeries,
  onResetZoom,
}: {
  zoom: ZoomState | null;
  anchorLabel: string;
  hidden: Set<string>;
  onToggleSeries: (key: string) => void;
  onResetZoom: () => void;
}) {
  return (
    <HStack mb={2} justify="space-between">
      <HStack spacing={2}>
        <Text fontSize="xs" color="#00f0ff" fontWeight="600" textTransform="uppercase" letterSpacing="0.15em">
          // Throughput
        </Text>
        {zoom && anchorLabel && (
          <Text fontSize="9px" color={zoom.anchor === "right" ? "#00ff41" : "#ffc800"} fontFamily="mono">
            {anchorLabel}
          </Text>
        )}
      </HStack>
      <HStack spacing={3}>
        {SERIES.map((s) => (
          <SeriesLegendToggle
            key={s.key}
            series={s}
            isHidden={hidden.has(s.key)}
            onToggle={() => onToggleSeries(s.key)}
          />
        ))}
        {zoom && <ResetZoomButton onClick={onResetZoom} />}
      </HStack>
    </HStack>
  );
}

export function ThroughputChart({ data }: { data: ThroughputPoint[] }) {
  const tooltipBg = "#0a0e17";
  const tooltipBorder = "rgba(0, 240, 255, 0.3)";

  // Series visibility toggle
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());

  // Drag-to-zoom state
  const [dragStart, setDragStart] = useState<number | null>(null);
  const [dragEnd, setDragEnd] = useState<number | null>(null);
  const [zoom, setZoom] = useState<ZoomState | null>(null);
  const isDragging = useRef(false);

  const dataMin = data.length > 0 ? data[0]!.timestamp : 0;
  const dataMax = data.length > 0 ? data[data.length - 1]!.timestamp : 0;

  const toggleSeries = useCallback((key: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        if (next.size < SERIES.length - 1) {
          next.add(key);
        }
      }
      return next;
    });
  }, []);

  const handleMouseDown = useCallback((e: ChartMouseEvent | null) => {
    if (e?.activeLabel != null) {
      isDragging.current = true;
      setDragStart(Number(e.activeLabel));
      setDragEnd(null);
    }
  }, []);

  const handleMouseMove = useCallback((e: ChartMouseEvent | null) => {
    if (isDragging.current && e?.activeLabel != null) {
      setDragEnd(Number(e.activeLabel));
    }
  }, []);

  const handleMouseUp = useCallback(() => {
    if (dragStart != null && dragEnd != null && dragStart !== dragEnd) {
      const left = Math.min(dragStart, dragEnd);
      const right = Math.max(dragStart, dragEnd);
      const durationMs = right - left;

      // Decide anchor based on proximity to data edges
      let anchor: ZoomAnchor = "fixed";
      if (right >= dataMax - ANCHOR_TOLERANCE_MS) {
        anchor = "right";
      } else if (left <= dataMin + ANCHOR_TOLERANCE_MS) {
        anchor = "left";
      }

      setZoom({ durationMs, anchor, left, right });
    }
    isDragging.current = false;
    setDragStart(null);
    setDragEnd(null);
  }, [dragStart, dragEnd, dataMin, dataMax]);

  const resetZoom = useCallback(() => {
    setZoom(null);
  }, []);

  // Resolve zoom to an absolute range, applying anchor logic
  const resolvedRange = useMemo(() => {
    if (!zoom) return null;
    switch (zoom.anchor) {
      case "right":
        return { left: dataMax - zoom.durationMs, right: dataMax };
      case "left":
        return { left: dataMin, right: dataMin + zoom.durationMs };
      case "fixed":
      default:
        return { left: zoom.left, right: zoom.right };
    }
  }, [zoom, dataMin, dataMax]);

  const chartData = resolvedRange
    ? data.filter((d) => d.timestamp >= resolvedRange.left && d.timestamp <= resolvedRange.right)
    : data;

  if (data.length < 2) {
    return (
      <Box bg="#0a0e17" p={4} borderRadius="2px" border="1px solid" borderColor="rgba(0, 240, 255, 0.15)" boxShadow="0 0 8px rgba(0, 240, 255, 0.08)" h="100%">
        <Text fontSize="sm" color="#4a6a7a" textTransform="uppercase" letterSpacing="0.1em">// THROUGHPUT — COLLECTING DATA...</Text>
      </Box>
    );
  }

  const anchorLabel = zoom
    ? zoom.anchor === "right"
      ? "LIVE"
      : zoom.anchor === "left"
        ? "PINNED"
        : ""
    : "";

  return (
    <Box
      bg="#0a0e17"
      p={4}
      borderRadius="2px"
      border="1px solid"
      borderColor="rgba(0, 240, 255, 0.15)"
      boxShadow="0 0 8px rgba(0, 240, 255, 0.08)"
      h="100%"
      userSelect="none"
    >
      <ChartHeader
        zoom={zoom}
        anchorLabel={anchorLabel}
        hidden={hidden}
        onToggleSeries={toggleSeries}
        onResetZoom={resetZoom}
      />
      <ResponsiveContainer width="100%" height={240}>
        <AreaChart
          data={chartData}
          onMouseDown={handleMouseDown as never}
          onMouseMove={handleMouseMove as never}
          onMouseUp={handleMouseUp}
          onMouseLeave={() => {
            if (isDragging.current) {
              handleMouseUp();
            }
          }}
          style={{ cursor: "crosshair" }}
        >
          <defs>
            {SERIES.map((s) => (
              <linearGradient key={s.gradientId} id={s.gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={s.color} stopOpacity={s.key === "failedPerSec" ? 0.25 : s.key === "completedPerSec" ? 0.25 : 0.3} />
                <stop offset="95%" stopColor={s.color} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <XAxis
            dataKey="timestamp"
            tickFormatter={formatTime}
            tick={{ fill: TICK_COLOR, fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            domain={["dataMin", "dataMax"]}
            type="number"
            scale="time"
          />
          <YAxis
            tick={{ fill: TICK_COLOR, fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            width={40}
          />
          <Tooltip
            contentStyle={{
              background: tooltipBg,
              border: `1px solid ${tooltipBorder}`,
              borderRadius: 2,
              fontSize: 12,
              color: "#00f0ff",
              boxShadow: "0 0 12px rgba(0, 240, 255, 0.15)",
            }}
            labelFormatter={(label) => formatTime(label as number)}
            isAnimationActive={false}
          />
          {SERIES.map((s) =>
            hidden.has(s.key) ? null : (
              <Area
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stroke={s.color}
                fill={`url(#${s.gradientId})`}
                strokeWidth={s.key === "failedPerSec" ? 1.5 : 2}
                isAnimationActive={false}
              />
            ),
          )}
          {dragStart != null && dragEnd != null && (
            <ReferenceArea
              x1={dragStart}
              x2={dragEnd}
              fill="rgba(0, 240, 255, 0.08)"
              stroke="rgba(0, 240, 255, 0.3)"
              strokeDasharray="3 3"
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </Box>
  );
}
