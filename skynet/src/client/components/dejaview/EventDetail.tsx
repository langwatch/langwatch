import { Box, Flex, Text, Badge } from "@chakra-ui/react";
import type { DejaViewEvent } from "../../../shared/dejaview.types.ts";
import { JsonViewer } from "./JsonViewer.tsx";

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toISOString().replace("T", " ").replace("Z", "");
}

interface EventDetailProps {
  event: DejaViewEvent;
}

export function EventDetail({ event }: EventDetailProps) {
  return (
    <Box
      borderWidth="1px"
      borderColor="rgba(74, 144, 217, 0.4)"
      borderRadius="2px"
      bg="surface.card"
      p={3}
      flexShrink={0}
    >
      {/* Header */}
      <Flex justify="space-between" align="center" mb={2}>
        <Text fontSize="sm" fontWeight="bold" color="#ffaa00">
          {event.type}
        </Text>
        <Text fontSize="10px" color="text.muted">
          {formatTimestamp(event.timestamp)}
        </Text>
      </Flex>

      {/* Key fields */}
      <Flex gap={4} mb={3} flexWrap="wrap">
        <Flex align="center" gap={1}>
          <Text fontSize="10px" color="text.muted">ID:</Text>
          <Text fontSize="xs">{event.id.slice(0, 16)}...</Text>
        </Flex>
        <Flex align="center" gap={1}>
          <Text fontSize="10px" color="text.muted">Aggregate:</Text>
          <Badge fontSize="10px" bg="badge.pending" color="badge.pending.text">
            {event.aggregateType}
          </Badge>
        </Flex>
        <Flex align="center" gap={1}>
          <Text fontSize="10px" color="text.muted">AggregateId:</Text>
          <Text fontSize="xs">{event.aggregateId}</Text>
        </Flex>
        <Flex align="center" gap={1}>
          <Text fontSize="10px" color="text.muted">Tenant:</Text>
          <Text fontSize="xs">{event.tenantId}</Text>
        </Flex>
      </Flex>

      {/* Event data */}
      <Box mb={2}>
        <Text fontSize="10px" color="text.muted" mb={1} textTransform="uppercase" letterSpacing="0.1em">
          Data
        </Text>
        <JsonViewer data={event.data} maxHeight="250px" />
      </Box>

      {/* Metadata */}
      {event.metadata && Object.keys(event.metadata).length > 0 && (
        <Box>
          <Text fontSize="10px" color="text.muted" mb={1} textTransform="uppercase" letterSpacing="0.1em">
            Metadata
          </Text>
          <JsonViewer data={event.metadata} maxHeight="100px" />
        </Box>
      )}
    </Box>
  );
}
