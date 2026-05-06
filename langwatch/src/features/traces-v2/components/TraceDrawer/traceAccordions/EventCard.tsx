import { Box, Button, HStack, Text, VStack } from "@chakra-ui/react";
import type React from "react";
import { LuArrowUpRight, LuCalendar } from "react-icons/lu";

interface EventCardProps {
  /** Event display name (e.g. "thumbs_up_down", "exception"). */
  name: string;
  /** Wall-clock timestamp the event was recorded at (ms). */
  timestampMs: number;
  /** Anchor that "+Nms" is computed from (trace start, span start, …). */
  anchorMs: number;
  /** Free-form key/value attributes the event carried. */
  attributes?: Record<string, unknown>;
  /** When set, renders a "Open span" button that jumps to the source span. */
  spanId?: string | null;
  /** Selection callback for the "Open span" affordance. */
  onSelectSpan?: (spanId: string) => void;
}

/**
 * One event in the Events accordion. The previous renderer was a single
 * line ("name +Nms") — way too sparse: attribute payloads (the actual
 * "what happened?") were hidden, and trace-level events had no way to
 * jump to the originating span. This card surfaces both, with the
 * attribute table visually nested under the header so the section
 * still scans quickly when there are many events.
 */
export const EventCard: React.FC<EventCardProps> = ({
  name,
  timestampMs,
  anchorMs,
  attributes,
  spanId,
  onSelectSpan,
}) => {
  const offsetMs = Math.max(0, Math.round(timestampMs - anchorMs));
  const attributeEntries = attributes ? Object.entries(attributes) : [];
  const hasAttributes = attributeEntries.length > 0;

  return (
    <Box
      borderWidth="1px"
      borderColor="border.subtle"
      borderRadius="md"
      bg="bg.subtle"
      paddingX={3}
      paddingY={2}
    >
      <HStack gap={3} align="center">
        <Text textStyle="sm" fontWeight="medium" color="fg" truncate>
          {name}
        </Text>
        <HStack gap={1} color="fg.subtle" flexShrink={0}>
          <LuCalendar size={12} />
          <Text textStyle="2xs" fontFamily="mono">
            +{offsetMs}ms
          </Text>
        </HStack>
        {spanId && onSelectSpan && (
          <Button
            size="2xs"
            variant="ghost"
            marginLeft="auto"
            color="fg.muted"
            gap={1}
            onClick={() => onSelectSpan(spanId)}
            aria-label={`Open span that emitted ${name}`}
          >
            Open span
            <LuArrowUpRight size={11} />
          </Button>
        )}
      </HStack>
      {hasAttributes && (
        <VStack
          align="stretch"
          gap={0.5}
          marginTop={1.5}
          paddingTop={1.5}
          borderTopWidth="1px"
          borderTopColor="border.subtle"
        >
          {attributeEntries.map(([key, value]) => (
            <HStack key={key} gap={3} align="flex-start">
              <Text
                textStyle="2xs"
                color="fg.muted"
                fontFamily="mono"
                minWidth="120px"
                flexShrink={0}
                truncate
              >
                {key}
              </Text>
              <Text
                textStyle="2xs"
                color="fg"
                fontFamily="mono"
                wordBreak="break-word"
                flex={1}
              >
                {formatValue(value)}
              </Text>
            </HStack>
          ))}
        </VStack>
      )}
    </Box>
  );
};

function formatValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
