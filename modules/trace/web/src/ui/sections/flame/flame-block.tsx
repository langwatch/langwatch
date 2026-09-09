import { Box, Text } from "@chakra-ui/react";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { formatDuration } from "../../../model/display-formatters.ts";
import { BlockLabel } from "./block-label.tsx";
import { MIN_BLOCK_PX, ROW_HEIGHT, TINY_BLOCK_PCT } from "../../../model/flame/constants.ts";
import { flameBlockVisuals } from "../../../model/flame/block-visuals.ts";
import { getSpanColor } from "../../../model/flame/colors.ts";
import { formatPercent } from "../../../behavior/flame/tree.ts";
import type { FlameNode, Viewport } from "../../../behavior/flame/types.ts";

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
  const leftPct = dur > 0 ? ((span.startTimeMs - viewport.startMs) / dur) * 100 : 0;
  const widthPct = dur > 0 ? (spanDur / dur) * 100 : 100;

  // Skip ultra-narrow blocks at large traces (perf).
  if (widthPct < 0.05 && totalSpanCount > 200) return null;

  const color = getSpanColor(span.type);
  // `gray.solid` is too low-saturation for the white-on-fill recipe every other palette uses — at 85% alpha on a
  // white canvas the result is a pale grey that white text dissolves into (operator report: "can't read the
  // letters" on Scenario Turn / module / execute_event_loop_cycle bars).
  const isLowContrastPalette = color === "gray.solid";
  // Sub-label-width blocks render calmer: softer fill, no border noise,
  // a 1px right gap and pill ends so a dense strip of adjacent tiny spans
  // reads as discrete events rather than one broken bar. Hover/selection
  // restores full treatment so targets still pop when picked.
  const isTiny = widthPct < TINY_BLOCK_PCT;
  const isError = span.status === "error";
  const isSelected = span.spanId === selectedSpanId;
  const isHovered = span.spanId === hoveredSpanId;
  const isFocused = span.spanId === focusedSpanId && !isSelected;
  const isAncestor = relatedSpanIds?.ancestors.has(span.spanId) ?? false;
  const isDirectChild = relatedSpanIds?.children.has(span.spanId) ?? false;
  const isDescendant = relatedSpanIds?.descendants.has(span.spanId) ?? false;
  const isRelated = isAncestor || isDescendant || isSelected || isHovered || isFocused;
  const isDimmed = dimOnHover && !!relatedSpanIds && !isRelated;
  const { bgAlphaPct, borderColor, borderWidth, boxShadow, lightBgAlphaPct, zIndex } =
    flameBlockVisuals({
      depth,
      emphasis: {
        isAncestor,
        isDirectChild,
        isDimmed,
        isError,
        isFocused,
        isHovered,
        isSelected,
        isTiny,
      },
    });
  const parentDurMs = parentDurationOf(node);
  const pctOfParent =
    parentDurMs !== null && parentDurMs > 0 ? (spanDur / parentDurMs) * 100 : null;
  const tooltip = blockTooltip({ fullDur, node, parentDurMs, pctOfParent, spanDur });

  return (
    <Tooltip content={tooltip} positioning={{ placement: "top" }}>
      <Box
        position="absolute"
        top={0}
        left={`${leftPct}%`}
        // Tiny blocks shave 1px off their width so adjacent micro-spans get
        // a visible seam instead of fusing into one continuous bar.
        width={isTiny ? `calc(${widthPct}% - 1px)` : `${widthPct}%`}
        minWidth={`${MIN_BLOCK_PX}px`}
        height={`${ROW_HEIGHT}px`}
        bg={{
          base: `${color}/${lightBgAlphaPct}`,
          _dark: `${color}/${bgAlphaPct}`,
        }}
        borderWidth={borderWidth}
        borderColor={borderColor}
        borderRadius={isTiny ? "full" : "sm"}
        cursor="pointer"
        pointerEvents="auto"
        overflow="hidden"
        zIndex={zIndex}
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
        // Pure-CSS hover lift so a target pops out of a dense strip the
        // instant the pointer touches it — no React round-trip needed
        // (the hoveredSpanId state still drives the richer emphasis).
        _hover={{
          filter: "brightness(1.08)",
          boxShadow: "0 0 0 1px var(--chakra-colors-fg-muted), var(--chakra-shadows-sm)",
          // Never demote a selected block below its resting priority —
          // the hover lift only applies to unselected blocks.
          zIndex: isSelected ? 3 : 2,
        }}
      >
        <Text
          textStyle="xs"
          // White text in both modes for the saturated palettes
          // (blue/green/purple/teal/orange/pink/cyan) — `lightBgAlphaPct` keeps the
          // fill saturated enough that white reads cleanly.
          color={isLowContrastPalette ? { base: "fg", _dark: "white" } : "white"}
          truncate
          lineHeight={1}
          // Dark drop-shadow lifts white text off the saturated fills.
          // On the grey-palette light-mode path we render dark text
          // instead, where this same shadow would double-print the
          // glyphs into bold-ish noise — drop it on that branch.
          textShadow={{
            base: isLowContrastPalette ? "none" : "0 1px 1px rgba(0,0,0,0.45)",
            _dark: "0 1px 1px rgba(0,0,0,0.45)",
          }}
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

/** How long the block's parent ran, or null at the root. */
function parentDurationOf(node: FlameNode): number | null {
  if (!node.parent) return null;
  return node.parent.span.endTimeMs - node.parent.span.startTimeMs;
}

/** The multi-line tooltip a block shows: name, duration, and the two shares. */
function blockTooltip({
  fullDur,
  node,
  parentDurMs,
  pctOfParent,
  spanDur,
}: {
  fullDur: number;
  node: FlameNode;
  parentDurMs: number | null;
  pctOfParent: number | null;
  spanDur: number;
}): string {
  const { span } = node;
  const pctOfTrace = fullDur > 0 ? (spanDur / fullDur) * 100 : null;
  const parentShare =
    pctOfParent !== null && node.parent
      ? `${formatPercent(pctOfParent)} of parent (${node.parent.span.name}, ${formatDuration(parentDurMs ?? 0)})`
      : null;

  return [
    span.name,
    `Duration: ${spanDur === 0 ? "<1ms" : formatDuration(spanDur)}`,
    parentShare,
    pctOfTrace !== null ? `${formatPercent(pctOfTrace)} of trace` : null,
    span.model ? `Model: ${span.model}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}
