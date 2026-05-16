import { HStack, Text } from "@chakra-ui/react";
import { TracePresenceAvatars } from "~/features/presence/components/TracePresenceAvatars";
import type { TraceListItem } from "../../../../../types/trace";
import type { CellDef } from "../../types";

export const TraceCell = {
  id: "trace",
  label: "Trace",
  render: ({ row }) => (
    <HStack gap={1.5} minWidth={0}>
      <TraceContent trace={row} size="compact" />
      <TracePresenceAvatars traceId={row.traceId} max={3} size="2xs" />
    </HStack>
  ),
  renderComfortable: ({ row }) => (
    <HStack gap={2} minWidth={0}>
      <TraceContent trace={row} size="comfortable" />
      <TracePresenceAvatars traceId={row.traceId} max={3} size="xs" />
    </HStack>
  ),
} as const satisfies CellDef<TraceListItem>;

const TraceContent: React.FC<{
  trace: TraceListItem;
  size: "compact" | "comfortable";
}> = ({ trace, size }) => {
  const comfortable = size === "comfortable";
  const nameStyle = comfortable ? "sm" : "xs";
  const idStyle = comfortable ? "xs" : "2xs";
  const hasName = Boolean(trace.traceName);

  return (
    <HStack gap={comfortable ? 2 : 1.5} minWidth={0}>
      {/* The span-type badge that used to sit here (`[LLM]`, `[span]`,
          …) was almost always the root span type — usually "span" or
          "llm" — and added noise rather than signal. Dropped. */}
      {hasName ? (
        <HStack gap={1.5} minWidth={0} overflow="hidden">
          <Text
            textStyle={nameStyle}
            color="fg"
            fontWeight={comfortable ? "500" : "medium"}
            truncate
            flexShrink={1}
            minWidth={0}
          >
            {trace.traceName}
          </Text>
          {/* Trace ID + the separating middle dot fade in only when
              the parent row is hovered — keeps the table dense by
              default but the ID is one mouse-over away. The reveal is
              keyed off the row Tr's `:hover` state via
              `data-row-hover-reveal`. */}
          <Text
            as="span"
            color="fg.subtle"
            flexShrink={0}
            data-row-hover-reveal
            opacity={0}
            transition="opacity 0.12s ease"
            aria-hidden="true"
          >
            ·
          </Text>
          <Text
            as="span"
            textStyle={idStyle}
            color="fg.subtle"
            whiteSpace="nowrap"
            flexShrink={0}
            userSelect="all"
            data-row-hover-reveal
            opacity={0}
            transition="opacity 0.12s ease"
          >
            {trace.traceId}
          </Text>
        </HStack>
      ) : (
        <Text
          textStyle={nameStyle}
          color="fg"
          userSelect="all"
          truncate
          flexShrink={1}
          minWidth={0}
        >
          {trace.traceId}
        </Text>
      )}
    </HStack>
  );
};
