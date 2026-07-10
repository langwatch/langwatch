/**
 * ComparisonWinnerCell - Renders the per-row comparison verdict in the
 * comparison column-target's cell (#5100 follow-up, generalized to N
 * candidates in #5101).
 *
 * Each row shows THREE things — the biggest-value framing per dogfood
 * ("what was right, and why"):
 *   1. `Winner: <variant name>` badge (per-variant color, gray for tie).
 *   2. The winning variant's actual output text ("What was right") in a
 *      bordered-left callout.
 *   3. The judge's reasoning text ("Why") in muted color.
 *
 * The cell names only the winner. With ten candidates an "A vs B vs C" chain
 * buries the one name the reader is looking for.
 *
 * The whole cell renders in a collapsed view by default (fixed max-height
 * + fade overlay at the bottom) with a Portal-based "expand to read all"
 * behaviour on click — same pattern BatchTargetCell already uses for
 * long prompt / agent outputs so the table reads as one cohesive design.
 *
 * Rows without a verdict (skipped / error / not-yet-run) render a subtle
 * dash so the column width is preserved and the table doesn't reflow
 * between reruns.
 */

import { Badge, Box, HStack, Portal, Text, VStack } from "@chakra-ui/react";
import { useCallback, useRef, useState } from "react";

import { isTextLikelyOverflowing } from "~/utils/textOverflowHeuristic";

import type { BatchComparisonColumn, BatchComparisonVerdict } from "./types";

/** Collapsed cell height cap. Long reasoning is faded out beyond this. */
const CELL_MAX_HEIGHT = 140;

/**
 * Cycled per variant position, matching WinRateChart's bar colors so the
 * chart and the rows read as one story. No red: the loser of a comparison
 * isn't a failure, and a red badge would code as one.
 */
const VARIANT_PALETTES = [
  "green",
  "purple",
  "blue",
  "orange",
  "pink",
  "teal",
] as const;

type WinnerVisual = {
  label: string;
  colorPalette: (typeof VARIANT_PALETTES)[number] | "gray";
};

const resolveWinner = (
  column: BatchComparisonColumn,
  verdict: BatchComparisonVerdict,
): WinnerVisual => {
  if (verdict.winnerId === null) {
    return { label: "Tie", colorPalette: "gray" };
  }
  const index = column.variants.findIndex((v) => v.id === verdict.winnerId);
  if (index < 0) {
    // The run named a winner this snapshot can't place. Show the raw
    // identifier rather than pretending the row had no verdict.
    return { label: verdict.winnerId, colorPalette: "gray" };
  }
  return {
    label: column.variants[index]!.name,
    colorPalette: VARIANT_PALETTES[index % VARIANT_PALETTES.length]!,
  };
};

export function ComparisonWinnerCell({
  column,
  verdict,
}: {
  column: BatchComparisonColumn;
  verdict: BatchComparisonVerdict | undefined;
}) {
  const cellRef = useRef<HTMLDivElement>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [expandedPosition, setExpandedPosition] = useState({
    top: 0,
    left: 0,
    width: 0,
  });

  const handleExpand = useCallback(() => {
    if (cellRef.current) {
      const rect = cellRef.current.getBoundingClientRect();
      const td = cellRef.current.closest("td");
      const tdWidth = td?.getBoundingClientRect().width ?? rect.width;
      const expandedWidth = Math.max(rect.width, tdWidth) + 24;
      const safetyMargin = 32;
      const viewportWidth = window.innerWidth;
      let left = rect.left - 12;
      if (left + expandedWidth > viewportWidth - safetyMargin) {
        left = viewportWidth - expandedWidth - safetyMargin;
      }
      setExpandedPosition({ top: rect.top, left, width: expandedWidth });
    }
    setIsExpanded(true);
  }, []);

  const handleCollapse = useCallback(() => setIsExpanded(false), []);

  if (!verdict) {
    return (
      <Text fontSize="13px" color="fg.subtle" data-testid="comparison-winner-none">
        -
      </Text>
    );
  }

  const isTie = verdict.winnerId === null;
  const winner = resolveWinner(column, verdict);
  const reasoning = verdict.reasoning?.trim();
  const winnerOutput = verdict.winnerOutput?.trim();

  const badge = (
    <Badge
      colorPalette={winner.colorPalette}
      size="sm"
      variant="subtle"
      data-testid={`comparison-winner-badge-${verdict.winnerId ?? "tie"}`}
    >
      {isTie ? "Tie" : `Winner: ${winner.label}`}
    </Badge>
  );

  // Combined text used only for the "is this cell overflowing" heuristic —
  // the actual render is structured (badge + output + reasoning).
  const combinedTextLength =
    (winnerOutput?.length ?? 0) + (reasoning?.length ?? 0);
  const isLikelyOverflowing =
    isTextLikelyOverflowing(`${winnerOutput ?? ""}\n\n${reasoning ?? ""}`) ||
    combinedTextLength > 400;

  const renderBody = (expanded: boolean) => (
    <VStack align="start" gap={2}>
      <HStack gap={1.5}>{badge}</HStack>
      {winnerOutput && (
        <Box
          borderLeftWidth="3px"
          borderLeftColor={isTie ? "gray.subtle" : `${winner.colorPalette}.subtle`}
          paddingLeft={2}
          paddingY={1}
          maxWidth="100%"
        >
          <Text
            fontSize="12px"
            color="fg"
            whiteSpace="pre-wrap"
            wordBreak="break-word"
            data-testid="comparison-winner-output"
          >
            {winnerOutput}
          </Text>
        </Box>
      )}
      {reasoning && (
        <Text
          fontSize="12px"
          color="fg.muted"
          whiteSpace="pre-wrap"
          wordBreak="break-word"
          data-testid="comparison-winner-reasoning"
        >
          {reasoning}
        </Text>
      )}
      {expanded && (
        <Text fontSize="11px" color="fg.subtle" alignSelf="end">
          click outside to close
        </Text>
      )}
    </VStack>
  );

  return (
    <>
      <VStack ref={cellRef} position="relative" align="stretch" gap={0}>
        <Box
          maxHeight={`${CELL_MAX_HEIGHT}px`}
          overflow="hidden"
          cursor={isLikelyOverflowing ? "pointer" : "default"}
          onClick={isLikelyOverflowing ? handleExpand : undefined}
        >
          {renderBody(false)}
        </Box>

        {/* Fade overlay + click-to-expand affordance. Only shown when the
            content is long enough to actually overflow. Matches the pattern
            BatchTargetCell uses for prompt / agent output cells so the table
            reads as one design system. */}
        {isLikelyOverflowing && (
          <Box
            position="absolute"
            bottom={0}
            left="-12px"
            right="-12px"
            height="40px"
            cursor="pointer"
            onClick={handleExpand}
            className="cell-fade-overlay"
            data-testid="comparison-winner-expand"
            css={{
              background:
                "linear-gradient(to bottom, transparent, var(--chakra-colors-bg-panel))",
              "tr:hover &": {
                background:
                  "linear-gradient(to bottom, transparent, var(--chakra-colors-bg-muted))",
              },
            }}
          />
        )}
      </VStack>

      {isExpanded && (
        <Portal>
          <Box
            position="fixed"
            inset={0}
            zIndex={1000}
            onClick={handleCollapse}
            data-testid="comparison-winner-backdrop"
          />
          <Box
            position="fixed"
            top={`${expandedPosition.top - 12}px`}
            left={`${expandedPosition.left}px`}
            width={`${Math.max(expandedPosition.width, 280)}px`}
            maxHeight={`calc(100vh - ${expandedPosition.top - 12}px - 32px)`}
            overflowY="auto"
            bg="bg.panel/75"
            backdropFilter="blur(8px)"
            borderRadius="md"
            boxShadow="0 0 0 2px var(--chakra-colors-border-emphasized), 0 4px 12px rgba(0,0,0,0.15)"
            zIndex={1001}
            padding={3}
            css={{ animation: "scale-in 0.15s ease-out" }}
          >
            {renderBody(true)}
          </Box>
        </Portal>
      )}
    </>
  );
}
