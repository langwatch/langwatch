import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { Tooltip } from "~/components/ui/tooltip";
import { formatCompact } from "./sessionSignals";
import type { CacheRebuildEvent, TokenTimelinePoint } from "./tokenTimeline";

const CHART_HEIGHT_PX = 56;
/** Past this many calls a number under every bar would overlap; label the ends. */
const NUMBER_EVERY_BAR_MAX = 24;

/**
 * One column per model call, in call order, on a shared baseline. Column
 * height is the call's total token volume; the light segment is what was
 * served from cache, the solid segment is what was paid fresh, and a red
 * segment is a call that re-created the cache instead of reading it. The
 * session fold only ever carries the SUM across the whole run — this is the
 * "where", built from the per-call points the drawer already has.
 */
export function TokenTimelineChart({
  points,
  rebuilds,
}: {
  points: TokenTimelinePoint[];
  rebuilds: CacheRebuildEvent[];
}) {
  if (points.length === 0) return null;

  const rebuiltAtMs = new Set(rebuilds.map((r) => r.atMs));
  const totalOf = (p: TokenTimelinePoint) =>
    p.cacheReadTokens + p.cacheCreationTokens + p.inputTokens + p.outputTokens;
  const maxTotal = Math.max(...points.map(totalOf), 1);
  const numberEveryBar = points.length <= NUMBER_EVERY_BAR_MAX;

  return (
    <VStack align="stretch" gap={3}>
      <VStack align="stretch" gap="4px">
        <HStack
          gap="3px"
          height={`${CHART_HEIGHT_PX}px`}
          alignItems="flex-end"
          borderBottomWidth="1px"
          borderColor="border.emphasized"
        >
          {points.map((point) => {
            const total = totalOf(point);
            const fresh =
              point.inputTokens +
              point.outputTokens +
              point.cacheCreationTokens;
            const isRebuild = rebuiltAtMs.has(point.atMs);
            const barPx = Math.max(
              4,
              Math.round((total / maxTotal) * CHART_HEIGHT_PX),
            );
            const freshPx =
              total === 0
                ? barPx
                : Math.min(
                    barPx,
                    Math.max(
                      fresh > 0 ? 1 : 0,
                      Math.round((fresh / total) * barPx),
                    ),
                  );
            const reusedPx = barPx - freshPx;
            const description = `Call ${point.index + 1} of ${points.length} · ${formatCompact(total)} tokens: ${formatCompact(point.cacheReadTokens)} from cache, ${formatCompact(fresh)} fresh${isRebuild ? ` · cache REBUILT (${formatCompact(point.cacheCreationTokens)})` : ""}`;
            return (
              <Tooltip
                key={point.index}
                content={description}
                positioning={{ placement: "top" }}
              >
                <Box
                  // Focusable so the tooltip's story is reachable without a
                  // mouse; the label carries the same text for screen readers.
                  tabIndex={0}
                  aria-label={description}
                  flex="1 1 0"
                  maxWidth="32px"
                  minWidth="3px"
                  height={`${CHART_HEIGHT_PX}px`}
                  display="flex"
                  flexDirection="column"
                  justifyContent="flex-end"
                >
                  {freshPx > 0 && (
                    <Box
                      height={`${freshPx}px`}
                      bg={isRebuild ? "red.solid" : "blue.solid/70"}
                      borderTopRadius="2px"
                    />
                  )}
                  {reusedPx > 0 && (
                    <Box
                      height={`${reusedPx}px`}
                      bg="blue.solid/25"
                      borderTopRadius={freshPx > 0 ? undefined : "2px"}
                    />
                  )}
                </Box>
              </Tooltip>
            );
          })}
        </HStack>

        {numberEveryBar ? (
          <HStack gap="3px">
            {points.map((point) => (
              <Text
                key={point.index}
                flex="1 1 0"
                maxWidth="32px"
                textStyle="2xs"
                color="fg.subtle"
                textAlign="center"
              >
                {point.index + 1}
              </Text>
            ))}
          </HStack>
        ) : (
          <HStack justify="space-between">
            <Text textStyle="2xs" color="fg.subtle">
              call 1
            </Text>
            <Text textStyle="2xs" color="fg.subtle">
              call {points.length}
            </Text>
          </HStack>
        )}
      </VStack>

      <HStack gap={4} flexWrap="wrap">
        <LegendSwatch color="blue.solid/25" label="reused from cache" />
        <LegendSwatch color="blue.solid/70" label="paid fresh" />
        {rebuilds.length > 0 && (
          <LegendSwatch color="red.solid" label="cache rebuild" />
        )}
      </HStack>

      {rebuilds.length > 0 && (
        <VStack align="stretch" gap={1.5}>
          {rebuilds.slice(0, 3).map((rebuild, index) => (
            <HStack key={index} gap={2} align="baseline">
              <Text
                textStyle="xs"
                color="red.fg"
                fontWeight="medium"
                flexShrink={0}
              >
                {`Call ${rebuild.callIndex + 1} rebuilt ${formatCompact(rebuild.cacheCreationTokens)} tokens instead of reusing ${formatCompact(rebuild.previousContextTokens)}`}
              </Text>
              {rebuild.precedingPrompt && (
                <Text textStyle="xs" color="fg.muted" truncate minWidth={0}>
                  {`after "${rebuild.precedingPrompt}"`}
                </Text>
              )}
            </HStack>
          ))}
          {rebuilds.length > 3 && (
            <Text textStyle="xs" color="fg.subtle">
              {`+${rebuilds.length - 3} more`}
            </Text>
          )}
        </VStack>
      )}
    </VStack>
  );
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <HStack gap={1.5}>
      <Box width="8px" height="8px" borderRadius="2px" bg={color} />
      <Text textStyle="2xs" color="fg.muted">
        {label}
      </Text>
    </HStack>
  );
}
