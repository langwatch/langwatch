import { Box, Flex, Text, Tooltip } from "@chakra-ui/react";
import { useMemo, useRef, useEffect } from "react";
import type { DejaViewEvent } from "../../../shared/dejaview.types.ts";

const EVENT_TYPE_COLORS: Record<string, string> = {
  "lw.obs.trace.span_received": "#00f0ff",
  "lw.obs.span.span_stored": "#00ff41",
  "lw.obs.trace.trace_completed": "#ff00ff",
};

const FALLBACK_COLORS = ["#4a90d9", "#ffaa00", "#ff0033", "#ff00ff", "#00ff41", "#00f0ff"];

function getEventColor(eventType: string): string {
  if (EVENT_TYPE_COLORS[eventType]) return EVENT_TYPE_COLORS[eventType]!;
  const hash = eventType.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return FALLBACK_COLORS[hash % FALLBACK_COLORS.length]!;
}

function shortenEventType(type: string): string {
  return type.replace(/^lw\.obs\.(trace\.|span\.)?/, "");
}

interface EventTimelineProps {
  events: DejaViewEvent[];
  currentIndex: number;
  onSelect: (index: number) => void;
}

export function EventTimeline({ events, currentIndex, onSelect }: EventTimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to keep current event visible
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const child = container.children[currentIndex] as HTMLElement | undefined;
    if (child) {
      child.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
    }
  }, [currentIndex]);

  const uniqueTypes = useMemo(() => {
    const types = new Set<string>();
    for (const event of events) types.add(event.type);
    return Array.from(types);
  }, [events]);

  const currentEvent = events[currentIndex];

  return (
    <Box
      borderWidth="1px"
      borderColor="border.subtle"
      borderRadius="2px"
      bg="surface.card"
      p={2}
      flexShrink={0}
    >
      {/* Scrollable event strip */}
      <Flex
        ref={scrollRef}
        gap="2px"
        overflowX="auto"
        pb={1}
        css={{
          "&::-webkit-scrollbar": { height: "4px" },
          "&::-webkit-scrollbar-track": { background: "transparent" },
          "&::-webkit-scrollbar-thumb": { background: "rgba(0, 240, 255, 0.2)", borderRadius: "2px" },
        }}
      >
        {events.map((event, i) => {
          const isCurrent = i === currentIndex;
          const color = getEventColor(event.type);
          return (
            <Tooltip
              key={event.id}
              label={`${event.type}\n${event.aggregateType}:${event.aggregateId.slice(0, 12)}`}
              fontSize="xs"
              bg="surface.tooltip"
              color="text.primary"
              borderColor="border.subtle"
              borderWidth="1px"
              hasArrow
            >
              <Box
                as="button"
                onClick={() => onSelect(i)}
                minW="28px"
                h="24px"
                display="flex"
                alignItems="center"
                justifyContent="center"
                fontSize="10px"
                fontFamily="mono"
                borderRadius="2px"
                cursor="pointer"
                flexShrink={0}
                bg={isCurrent ? color : "transparent"}
                color={isCurrent ? "#000408" : color}
                fontWeight={isCurrent ? "bold" : "normal"}
                borderWidth="1px"
                borderColor={isCurrent ? color : `${color}40`}
                _hover={{ bg: `${color}30`, borderColor: color }}
                transition="all 0.1s"
              >
                {i + 1}
              </Box>
            </Tooltip>
          );
        })}
      </Flex>

      {/* Current event type + legend */}
      <Flex justify="space-between" align="center" mt={1}>
        <Text fontSize="xs" color={currentEvent ? getEventColor(currentEvent.type) : "text.muted"} fontWeight="bold">
          {currentEvent?.type ?? "No event"}
        </Text>
        <Text fontSize="10px" color="text.muted">
          {currentIndex + 1}/{events.length}
        </Text>
      </Flex>

      {/* Legend */}
      <Flex gap={3} mt={1} flexWrap="wrap">
        {uniqueTypes.map((type) => (
          <Flex key={type} align="center" gap={1}>
            <Box w="8px" h="8px" borderRadius="1px" bg={getEventColor(type)} />
            <Text fontSize="10px" color="text.muted">{shortenEventType(type)}</Text>
          </Flex>
        ))}
      </Flex>
    </Box>
  );
}
