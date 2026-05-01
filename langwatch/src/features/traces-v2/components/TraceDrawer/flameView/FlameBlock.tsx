import { Box, Text } from "@chakra-ui/react";
import { Tooltip } from "~/components/ui/tooltip";
import { formatDuration, SPAN_TYPE_COLORS } from "../../../utils/formatters";
import { BlockLabel } from "./BlockLabel";
import {
  DEPTH_FADE_FLOOR,
  DEPTH_FADE_STEP,
  MIN_BLOCK_PX,
  ROW_HEIGHT,
} from "./constants";
import { formatPercent } from "./tree";
import type { FlameNode, Viewport } from "./types";

interface RelatedSpanIds {
  ancestors: Set<string>;
  children: Set<string>;
  descendants: Set<string>;
}

interface FlameBlockProps {
  node: FlameNode;
  depth: number;
  viewport: Viewport;
  fullDur: number;
  totalSpanCount: number;
  selectedSpanId: string | null;
  hoveredSpanId: string | null;
  focusedSpanId: string | null;
  relatedSpanIds: RelatedSpanIds | null;
  dimOnHover: boolean;
  onSpanClick: (spanId: string) => void;
  onSpanDoubleClick: (spanId: string) => void;
  onHoverChange: (spanId: string | null) => void;
}

/**
 * One span rectangle inside a FlameRow. Owns the visual hierarchy (selected
 * > focused > hovered > ancestor/child > rest), tooltip composition, and
 * click/hover handlers. Pure presentation — state lives in the parent.
 */
export function FlameBlock({
  node,
  depth,
  viewport,
  fullDur,
  totalSpanCount,
  selectedSpanId,
  hoveredSpanId,
  focusedSpanId,
  relatedSpanIds,
  dimOnHover,
  onSpanClick,
  onSpanDoubleClick,
  onHoverChange,
}: FlameBlockProps) {
  const { span } = node;
  const dur = viewport.endMs - viewport.startMs;
  const spanDur = span.endTimeMs - span.startTimeMs;
  const leftPct =
    dur > 0 ? ((span.startTimeMs - viewport.startMs) / dur) * 100 : 0;
  const widthPct = dur > 0 ? (spanDur / dur) * 100 : 100;

  // Skip ultra-narrow blocks at large traces (perf).
  if (widthPct < 0.05 && totalSpanCount > 200) return null;

  const color =
    (SPAN_TYPE_COLORS[span.type ?? "span"] as string) ?? "gray.solid";
  const depthAlpha = Math.max(
    DEPTH_FADE_FLOOR,
    1 - depth * DEPTH_FADE_STEP,
  );
  const isError = span.status === "error";
  const isSelected = span.spanId === selectedSpanId;
  const isHovered = span.spanId === hoveredSpanId;
  const isFocused = span.spanId === focusedSpanId && !isSelected;
  const isAncestor = relatedSpanIds?.ancestors.has(span.spanId) ?? false;
  const isDirectChild = relatedSpanIds?.children.has(span.spanId) ?? false;
  const isDescendant = relatedSpanIds?.descendants.has(span.spanId) ?? false;
  const isRelated =
    isAncestor || isDescendant || isSelected || isHovered || isFocused;
  const isEmphasized = isSelected || isHovered || isFocused;
  const isDimmed = dimOnHover && !!relatedSpanIds && !isRelated;
  const bgAlphaPct = Math.round(
    (isEmphasized
      ? 1
      : isAncestor
        ? Math.max(depthAlpha, 0.85)
        : isDirectChild
          ? Math.max(depthAlpha, 0.8)
          : isDimmed
            ? depthAlpha * 0.3
            : depthAlpha) * 100,
  );
  const isZeroDuration = spanDur === 0;

  const parentDurMs = node.parent
    ? node.parent.span.endTimeMs - node.parent.span.startTimeMs
    : null;
  const pctOfParent =
    parentDurMs !== null && parentDurMs > 0
      ? (spanDur / parentDurMs) * 100
      : null;
  const pctOfTrace = fullDur > 0 ? (spanDur / fullDur) * 100 : null;

  const tooltipLines = [
    span.name,
    `Duration: ${isZeroDuration ? "<1ms" : formatDuration(spanDur)}`,
    pctOfParent !== null && node.parent
      ? `${formatPercent(pctOfParent)} of parent (${node.parent.span.name}, ${formatDuration(parentDurMs ?? 0)})`
      : null,
    pctOfTrace !== null && node.parent
      ? `${formatPercent(pctOfTrace)} of trace`
      : null,
    span.model ? `Model: ${span.model}` : null,
    node.isOrphaned ? "⚠ Parent not in trace" : null,
  ].filter(Boolean);

  // Visual hierarchy: selected > focused > hovered > ancestor/child > rest.
  const borderWidth = isError
    ? "1.5px"
    : isSelected
      ? "2px"
      : isFocused
        ? "1.5px"
        : isAncestor || isDirectChild
          ? "1px"
          : "0.5px";
  const borderColor = isError
    ? "red.solid"
    : isSelected
      ? "fg"
      : isFocused
        ? "fg.muted"
        : isAncestor
          ? "fg.muted"
          : isDirectChild
            ? "border.emphasized"
            : "border.muted";
  const boxShadow = isSelected
    ? "0 0 0 2px var(--chakra-colors-bg-panel), 0 2px 8px rgba(0,0,0,0.18)"
    : isHovered
      ? "sm"
      : undefined;

  return (
    <Tooltip
      content={tooltipLines.join("\n")}
      positioning={{ placement: "top" }}
    >
      <Box
        position="absolute"
        top={0}
        left={`${leftPct}%`}
        width={`${widthPct}%`}
        minWidth={`${MIN_BLOCK_PX}px`}
        height={`${ROW_HEIGHT}px`}
        bg={`${color}/${bgAlphaPct}`}
        borderWidth={borderWidth}
        borderColor={borderColor}
        borderStyle={node.isOrphaned ? "dashed" : "solid"}
        borderRadius="sm"
        cursor="pointer"
        pointerEvents="auto"
        overflow="hidden"
        zIndex={isSelected ? 3 : isFocused || isHovered ? 2 : 1}
        onClick={(e) => {
          e.stopPropagation();
          onSpanClick(span.spanId);
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onSpanDoubleClick(span.spanId);
        }}
        onMouseEnter={() => onHoverChange(span.spanId)}
        onMouseLeave={() => onHoverChange(null)}
        display="flex"
        alignItems="center"
        paddingX={1}
        boxShadow={boxShadow}
      >
        <Text
          textStyle="xs"
          color={isEmphasized ? "white" : "white/90"}
          truncate
          lineHeight={1}
          userSelect="none"
          textShadow="0 1px 1px rgba(0,0,0,0.35)"
        >
          <BlockLabel
            name={span.name}
            duration={spanDur}
            model={span.type === "llm" ? span.model : null}
            pctOfParent={pctOfParent}
            widthPct={widthPct}
          />
        </Text>
      </Box>
    </Tooltip>
  );
}
