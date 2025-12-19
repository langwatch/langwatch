import React from "react";
import { Box, Text } from "ink";
import type { Event } from "../lib/types";
import { JsonViewer } from "./JsonViewer";

interface EventDetailProps {
  event: Event;
  maxJsonLines?: number;
}

/**
 * Formats a Unix timestamp to a human-readable string.
 */
function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toISOString().replace("T", " ").replace("Z", "");
}

/**
 * Detailed view of a single event with metadata and JSON data.
 *
 * @example
 * <EventDetail event={currentEvent} maxJsonLines={10} />
 */
export const EventDetail: React.FC<EventDetailProps> = ({
  event,
  maxJsonLines = 10,
}) => {
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="blue" paddingX={1} flexShrink={0}>
      {/* Event summary header */}
      <Box justifyContent="space-between">
        <Text bold color="yellow">
          {event.type}
        </Text>
        <Text dimColor>{formatTimestamp(event.timestamp)}</Text>
      </Box>

      {/* Key fields */}
      <Box gap={2}>
        <Box>
          <Text dimColor>ID: </Text>
          <Text>{event.id.slice(0, 12)}...</Text>
        </Box>
        <Box>
          <Text dimColor>Aggregate: </Text>
          <Text color="cyan">{event.aggregateType}</Text>
        </Box>
        <Box>
          <Text dimColor>Tenant: </Text>
          <Text>{event.tenantId}</Text>
        </Box>
      </Box>

      {/* Event data JSON */}
      <Box flexDirection="column">
        <Text bold color="gray">
          Data:
        </Text>
        <JsonViewer data={event.data} maxLines={maxJsonLines} />
      </Box>

      {/* Metadata if present */}
      {event.metadata && Object.keys(event.metadata).length > 0 && (
        <Box flexDirection="column">
          <Text bold color="gray">
            Metadata:
          </Text>
          <JsonViewer data={event.metadata} maxLines={3} />
        </Box>
      )}
    </Box>
  );
};








