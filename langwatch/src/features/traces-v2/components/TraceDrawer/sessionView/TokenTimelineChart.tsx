import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { Tooltip } from "~/components/ui/tooltip";
import { formatCompact } from "./sessionSignals";
import type { CacheRebuildEvent, TokenTimelinePoint } from "./tokenTimeline";

/**
 * One bar per model call, tallest where the session spent the most tokens,
 * red where a call re-created the cache instead of reading it. The session
 * fold only ever carries the SUM across the whole run — this is the "where",
 * built from the per-call points the drawer already has.
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
  const maxTotal = Math.max(
    ...points.map(
      (p) => p.cacheReadTokens + p.cacheCreationTokens + p.inputTokens + p.outputTokens,
    ),
    1,
  );

  return (
    <VStack align="stretch" gap={3}>
      <HStack gap="2px" height="48px" alignItems="flex-end">
        {points.map((point) => {
          const total =
            point.cacheReadTokens +
            point.cacheCreationTokens +
            point.inputTokens +
            point.outputTokens;
          const heightPct = Math.max(6, (total / maxTotal) * 100);
          const isRebuild = rebuiltAtMs.has(point.atMs);
          return (
            <Tooltip
              key={point.index}
              content={
                isRebuild
                  ? `Call ${point.index + 1}: ${formatCompact(total)} tokens — cache REBUILT (${formatCompact(point.cacheCreationTokens)})`
                  : `Call ${point.index + 1}: ${formatCompact(total)} tokens — ${formatCompact(point.cacheReadTokens)} reused from cache`
              }
              positioning={{ placement: "top" }}
            >
              <Box
                flex="1 1 0"
                minWidth="3px"
                height={`${heightPct}%`}
                bg={isRebuild ? "red.solid" : "blue.solid/45"}
                borderRadius="full"
              />
            </Tooltip>
          );
        })}
      </HStack>

      {rebuilds.length > 0 && (
        <VStack align="stretch" gap={1.5}>
          {rebuilds.slice(0, 3).map((rebuild, index) => (
            <HStack key={index} gap={2} align="baseline">
              <Text textStyle="xs" color="red.fg" fontWeight="medium" flexShrink={0}>
                {`Rebuilt ${formatCompact(rebuild.cacheCreationTokens)} tokens instead of reusing ${formatCompact(rebuild.previousContextTokens)}`}
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
