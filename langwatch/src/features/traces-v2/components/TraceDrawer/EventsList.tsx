import { useState } from "react";
import { Box, Button, HStack, Icon, Text, VStack } from "@chakra-ui/react";
import { LuChevronDown, LuChevronRight, LuInfo } from "react-icons/lu";
import { formatDuration } from "../../utils/formatters";

interface InfoEvent {
  name: string;
  timestamp: number;
  attributes?: Record<string, unknown>;
  spanName?: string;
  spanId?: string;
}

interface EventsListProps {
  events: InfoEvent[];
  empty?: string;
  onSelectSpan?: (spanId: string) => void;
  showSpanOrigin?: boolean;
}

function EventCard({
  event,
  onSelectSpan,
  showSpanOrigin,
}: {
  event: InfoEvent;
  onSelectSpan?: (spanId: string) => void;
  showSpanOrigin: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasAttrs =
    event.attributes && Object.keys(event.attributes).length > 0;

  return (
    <Box borderLeftWidth="2px" borderColor="blue.muted" paddingLeft={2}>
      <HStack gap={2} marginBottom={0.5}>
        <Icon as={LuInfo} boxSize={3} color="blue.fg" flexShrink={0} />
        <Text textStyle="xs" fontWeight="medium" color="fg">
          {event.name}
        </Text>
        <Box flex={1} />
        <Text textStyle="xs" fontFamily="mono" color="fg.subtle">
          +{formatDuration(event.timestamp)}
        </Text>
      </HStack>

      {showSpanOrigin && event.spanName && (
        <HStack gap={1} marginBottom={0.5}>
          <Text textStyle="xs" color="fg.subtle">
            from
          </Text>
          <Button
            size="xs"
            variant="plain"
            color="blue.fg"
            padding={0}
            height="auto"
            fontFamily="mono"
            onClick={() => event.spanId && onSelectSpan?.(event.spanId)}
          >
            {event.spanName}
          </Button>
          {event.spanId && (
            <Text textStyle="xs" fontFamily="mono" color="fg.subtle">
              ({event.spanId.slice(0, 8)})
            </Text>
          )}
        </HStack>
      )}

      {hasAttrs && (
        <Box>
          <Button
            size="xs"
            variant="plain"
            color="blue.fg"
            padding={0}
            height="auto"
            marginBottom={1}
            onClick={() => setExpanded(!expanded)}
          >
            <Icon
              as={expanded ? LuChevronDown : LuChevronRight}
              boxSize={3}
            />
            {expanded ? "Hide details" : "Show details"}
          </Button>
          {expanded && (
            <Box
              bg="bg.subtle"
              borderRadius="sm"
              borderWidth="1px"
              borderColor="border"
              padding={2}
              fontFamily="mono"
              fontSize="xs"
            >
              {Object.entries(event.attributes!).map(([k, v]) => (
                <HStack key={k} gap={2} marginBottom={0.5}>
                  <Text color="fg.muted" flexShrink={0} width="180px" truncate>
                    {k}:
                  </Text>
                  <Text
                    color="fg"
                    whiteSpace="pre-wrap"
                    wordBreak="break-all"
                    lineHeight="1.5"
                  >
                    {String(v)}
                  </Text>
                </HStack>
              ))}
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}

export function EventsList({
  events,
  empty = "No events recorded",
  onSelectSpan,
  showSpanOrigin = true,
}: EventsListProps) {
  if (events.length === 0) {
    return (
      <Text textStyle="xs" color="fg.subtle">
        {empty}
      </Text>
    );
  }

  return (
    <VStack align="stretch" gap={2}>
      <Text textStyle="xs" color="fg.subtle" marginBottom={1}>
        {events.length} event{events.length !== 1 ? "s" : ""}
      </Text>
      {events.map((evt, i) => (
        <EventCard
          key={i}
          event={evt}
          onSelectSpan={onSelectSpan}
          showSpanOrigin={showSpanOrigin}
        />
      ))}
    </VStack>
  );
}
