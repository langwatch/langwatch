import { Flex, HStack, Text } from "@chakra-ui/react";
import { formatDuration } from "../../../utils/formatters";
import { formatPercent } from "./tree";
import type { FlameNode, SpanContext } from "./types";

interface FlameContextStripProps {
  contextNode: FlameNode | null;
  contextInfo: SpanContext | null;
  spanCount: number;
  fullDur: number;
  showZoomHint: boolean;
}

/**
 * Context info strip: shows name + duration + parent-ratio + trace-ratio
 * for the hovered / focused / selected span. Falls back to a trace summary
 * when nothing is active.
 */
export function FlameContextStrip({
  contextNode,
  contextInfo,
  spanCount,
  fullDur,
  showZoomHint,
}: FlameContextStripProps) {
  return (
    <Flex
      align="center"
      gap={2}
      paddingX={3}
      paddingY={1}
      flexShrink={0}
      height="26px"
      borderTopWidth="0.5px"
      borderBottomWidth="0.5px"
      borderColor="border.subtle"
      bg="bg.subtle"
    >
      {contextNode && contextInfo ? (
        <>
          <Text
            textStyle="xs"
            fontWeight="medium"
            color="fg"
            truncate
            maxWidth="220px"
          >
            {contextNode.span.name}
          </Text>
          <Text textStyle="xs" color="fg.muted" whiteSpace="nowrap">
            {formatDuration(contextInfo.duration)}
          </Text>
          {contextInfo.pctOfParent !== null &&
            contextInfo.parentName !== null &&
            contextInfo.parentDuration !== null && (
              <HStack gap={1} minWidth={0}>
                <Text textStyle="xs" color="fg.subtle" whiteSpace="nowrap">
                  →
                </Text>
                <Text
                  textStyle="xs"
                  color="fg.emphasized"
                  fontWeight="semibold"
                  whiteSpace="nowrap"
                >
                  {formatPercent(contextInfo.pctOfParent)}
                </Text>
                <Text textStyle="xs" color="fg.subtle" whiteSpace="nowrap">
                  of
                </Text>
                <Text textStyle="xs" color="fg.muted" truncate maxWidth="160px">
                  {contextInfo.parentName}
                </Text>
                <Text textStyle="xs" color="fg.subtle" whiteSpace="nowrap">
                  ({formatDuration(contextInfo.parentDuration)})
                </Text>
              </HStack>
            )}
          {contextInfo.pctOfTrace !== null && (
            <Text textStyle="xs" color="fg.subtle" whiteSpace="nowrap">
              · {formatPercent(contextInfo.pctOfTrace)} of trace
            </Text>
          )}
        </>
      ) : (
        <Text textStyle="xs" color="fg.subtle">
          {spanCount} span{spanCount === 1 ? "" : "s"} ·{" "}
          {formatDuration(fullDur)} ·{" "}
          {showZoomHint
            ? "drag across the ruler to zoom into a region"
            : "hover a span for details"}
        </Text>
      )}
    </Flex>
  );
}
