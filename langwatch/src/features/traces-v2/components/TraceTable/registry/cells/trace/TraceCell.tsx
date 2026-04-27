import { Box, HStack, Text } from "@chakra-ui/react";
import type React from "react";
import type { TraceListItem } from "../../../../../types/trace";
import { SPAN_TYPE_BADGE_STYLES } from "../../../../../utils/formatters";
import { TraceIdPeek } from "../../../../TraceIdPeek";
import type { CellDef } from "../../types";

const PROMINENT_SPAN_TYPES = new Set(["llm", "agent", "workflow"]);

export const TraceCell: CellDef<TraceListItem> = {
  id: "trace",
  label: "Trace",
  render: ({ row }) => (
    <HStack gap={1.5} minWidth={0}>
      <Box onClick={(e: React.MouseEvent) => e.stopPropagation()}>
        <TraceIdPeek traceId={row.traceId} />
      </Box>
      <TraceContent trace={row} size="compact" />
    </HStack>
  ),
  renderComfortable: ({ row }) => (
    <HStack gap={2} minWidth={0}>
      <Box onClick={(e: React.MouseEvent) => e.stopPropagation()}>
        <TraceIdPeek traceId={row.traceId} />
      </Box>
      <TraceContent trace={row} size="comfortable" />
    </HStack>
  ),
};

const TraceContent: React.FC<{
  trace: TraceListItem;
  size: "compact" | "comfortable";
}> = ({ trace, size }) => {
  const spanType = trace.rootSpanType;
  const hasName = Boolean(trace.rootSpanName);
  const displayType =
    spanType && PROMINENT_SPAN_TYPES.has(spanType) ? spanType : "span";
  const badgeStyle = SPAN_TYPE_BADGE_STYLES[displayType];
  const nameStyle = size === "comfortable" ? "sm" : "xs";
  const idStyle = size === "comfortable" ? "xs" : "2xs";

  return (
    <HStack gap={size === "comfortable" ? 2 : 1.5} minWidth={0}>
      {spanType && (
        <Text
          textStyle="2xs"
          fontWeight="semibold"
          color={badgeStyle?.color ?? "gray.fg"}
          background={badgeStyle?.bg ?? "gray.subtle"}
          paddingX={1.5}
          borderRadius="sm"
          flexShrink={0}
          lineHeight="tall"
        >
          {displayType.toUpperCase()}
        </Text>
      )}
      {hasName ? (
        <HStack gap={2} minWidth={0} overflow="hidden">
          <Text
            textStyle={nameStyle}
            color="fg"
            fontWeight={size === "comfortable" ? "500" : "medium"}
            truncate
            flexShrink={1}
            minWidth={0}
          >
            {trace.rootSpanName}
          </Text>
          <Box
            width="4px"
            height="4px"
            borderRadius="full"
            bg="orange.solid"
            boxShadow="0 0 4px 0.5px var(--chakra-colors-orange-solid)"
            flexShrink={0}
            opacity={0.85}
          />
          <Text
            as="span"
            fontFamily="mono"
            textStyle={idStyle}
            color="fg.subtle"
            whiteSpace="nowrap"
            flexShrink={0}
            userSelect="all"
          >
            {trace.traceId}
          </Text>
        </HStack>
      ) : (
        <Text fontFamily="mono" textStyle={nameStyle} color="fg" userSelect="all">
          {trace.traceId}
        </Text>
      )}
    </HStack>
  );
};
