import React, { useMemo } from "react";
import { Box, Text, useStdout } from "ink";
import type { Event } from "../lib/types";

/** Color mapping for different event types */
const EVENT_TYPE_COLORS: Record<string, string> = {
  "lw.obs.trace.span_received": "cyan",
  "lw.obs.span.span_stored": "green",
  "lw.obs.trace.trace_completed": "magenta",
};

/** Get color for an event type, cycling through colors for unknown types */
function getEventColor(eventType: string): string {
  if (EVENT_TYPE_COLORS[eventType]) {
    return EVENT_TYPE_COLORS[eventType];
  }
  // For unknown types, derive a color from the event type hash
  const fallbackColors = ["blue", "yellow", "red", "magenta", "green", "cyan"];
  const hash = eventType.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return fallbackColors[hash % fallbackColors.length] ?? "white";
}

interface EventTimelineProps {
  events: Event[];
  currentIndex: number;
}

/**
 * Horizontal scrollable timeline showing events as numbered boxes.
 * Current event is highlighted. Shows event type below.
 *
 * @example
 * <EventTimeline events={events} currentIndex={3} />
 */
export const EventTimeline: React.FC<EventTimelineProps> = ({
  events,
  currentIndex,
}) => {
  const { stdout } = useStdout();
  const terminalWidth = stdout?.columns ?? 80;

  // Calculate how many events fit in the visible window
  // Each event takes ~5 chars: "[XX] "
  const eventWidth = 5;
  const maxVisible = Math.floor((terminalWidth - 10) / eventWidth);

  // Calculate window to show (centered on current event)
  const { startIndex, endIndex } = useMemo(() => {
    const halfWindow = Math.floor(maxVisible / 2);
    let start = Math.max(0, currentIndex - halfWindow);
    let end = Math.min(events.length, start + maxVisible);

    // Adjust start if we're near the end
    if (end === events.length && end - start < maxVisible) {
      start = Math.max(0, end - maxVisible);
    }

    return { startIndex: start, endIndex: end };
  }, [currentIndex, maxVisible, events.length]);

  const visibleEvents = events.slice(startIndex, endIndex);
  const currentEvent = events[currentIndex];

  // Get unique event types for legend
  const uniqueEventTypes = useMemo(() => {
    const types = new Set<string>();
    for (const event of events) {
      types.add(event.type);
    }
    return Array.from(types);
  }, [events]);

  // Shorten event type for display (remove common prefix)
  const shortenEventType = (type: string): string => {
    // Remove "lw.obs." prefix and common parts
    return type.replace(/^lw\.obs\.(trace\.|span\.)?/, "");
  };

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1} flexShrink={0}>
      <Box>
        {startIndex > 0 && <Text dimColor>{"< "}</Text>}
        {visibleEvents.map((event, i) => {
          const actualIndex = startIndex + i;
          const isCurrent = actualIndex === currentIndex;
          const num = actualIndex + 1;
          const eventColor = getEventColor(event.type);

          return (
            <React.Fragment key={event.id}>
              <Text
                color={eventColor}
                bold={isCurrent}
                inverse={isCurrent}
              >
                [{num}]
              </Text>
              {i < visibleEvents.length - 1 && <Text> </Text>}
            </React.Fragment>
          );
        })}
        {endIndex < events.length && <Text dimColor>{" >"}</Text>}
      </Box>

      <Box justifyContent="space-between">
        <Text color={currentEvent ? getEventColor(currentEvent.type) : "yellow"}>
          {currentEvent?.type ?? "No event"}
        </Text>
        <Text dimColor>← h/l →</Text>
      </Box>

      {/* Event type color legend */}
      <Box>
        <Text dimColor>Legend: </Text>
        {uniqueEventTypes.map((type, i) => (
          <React.Fragment key={type}>
            <Text color={getEventColor(type)}>{shortenEventType(type)}</Text>
            {i < uniqueEventTypes.length - 1 && <Text dimColor> • </Text>}
          </React.Fragment>
        ))}
      </Box>
    </Box>
  );
};
