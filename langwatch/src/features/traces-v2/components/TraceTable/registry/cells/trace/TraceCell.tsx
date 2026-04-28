import { Box, HStack, Text } from "@chakra-ui/react";
import type React from "react";
import { TracePresenceAvatars } from "~/features/presence/components/TracePresenceAvatars";
import type { TraceListItem } from "../../../../../types/trace";
import { TraceIdPeek } from "../../../../TraceIdPeek";
import type { CellDef } from "../../types";
import { SpanTypeBadge } from "./SpanTypeBadge";

export const TraceCell: CellDef<TraceListItem> = {
  id: "trace",
  label: "Trace",
  render: ({ row }) => (
    <HStack gap={1.5} minWidth={0}>
      <Box onClick={(e: React.MouseEvent) => e.stopPropagation()}>
        <TraceIdPeek traceId={row.traceId} />
      </Box>
      <TraceContent trace={row} size="compact" />
      <TracePresenceAvatars traceId={row.traceId} max={3} size="2xs" />
    </HStack>
  ),
  renderComfortable: ({ row }) => (
    <HStack gap={2} minWidth={0}>
      <Box onClick={(e: React.MouseEvent) => e.stopPropagation()}>
        <TraceIdPeek traceId={row.traceId} />
      </Box>
      <TraceContent trace={row} size="comfortable" />
      <TracePresenceAvatars traceId={row.traceId} max={3} size="xs" />
    </HStack>
  ),
};

const TraceContent: React.FC<{
  trace: TraceListItem;
  size: "compact" | "comfortable";
}> = ({ trace, size }) => {
  const comfortable = size === "comfortable";
  const nameStyle = comfortable ? "sm" : "xs";
  const idStyle = comfortable ? "xs" : "2xs";
  const hasName = Boolean(trace.rootSpanName);

  return (
    <HStack gap={comfortable ? 2 : 1.5} minWidth={0}>
      {trace.rootSpanType && (
        <SpanTypeBadge spanType={trace.rootSpanType} flexShrink={0} />
      )}
      {hasName ? (
        <HStack gap={2} minWidth={0} overflow="hidden">
          <Text
            textStyle={nameStyle}
            color="fg"
            fontWeight={comfortable ? "500" : "medium"}
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
        <Text
          fontFamily="mono"
          textStyle={nameStyle}
          color="fg"
          userSelect="all"
        >
          {trace.traceId}
        </Text>
      )}
    </HStack>
  );
};
