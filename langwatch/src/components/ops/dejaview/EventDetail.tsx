import { Badge, Box, HStack, Text, VStack } from "@chakra-ui/react";
import { JsonViewer } from "~/components/ops/JsonViewer";
import { hashEventTypeColor, formatTimestamp } from "./fragment";
import type { EventResult } from "./types";

export function EventDetail({
  event,
  previousEvent,
}: {
  event: EventResult;
  previousEvent: EventResult | null;
}) {
  return (
    <VStack align="stretch" gap={0}>
      <Box padding={4} borderBottom="1px solid" borderBottomColor="border">
        <VStack align="stretch" gap={2}>
          <HStack gap={4}>
            <VStack align="start" gap={0}>
              <Text textStyle="xs" color="fg.muted">
                Event ID
              </Text>
              <Text textStyle="xs" fontFamily="mono">
                {event.eventId}
              </Text>
            </VStack>
            <VStack align="start" gap={0}>
              <Text textStyle="xs" color="fg.muted">
                Type
              </Text>
              <Badge
                size="sm"
                colorPalette={hashEventTypeColor(event.eventType)}
                variant="subtle"
              >
                {event.eventType}
              </Badge>
            </VStack>
            <VStack align="start" gap={0}>
              <Text textStyle="xs" color="fg.muted">
                Timestamp
              </Text>
              <Text textStyle="xs" fontFamily="mono">
                {formatTimestamp(event.eventTimestamp)}
              </Text>
            </VStack>
          </HStack>
        </VStack>
      </Box>
      <Box padding={4}>
        <Text textStyle="xs" fontWeight="medium" marginBottom={2}>
          Payload
          {previousEvent && (
            <Text as="span" color="orange.400" marginLeft={2}>
              (changes highlighted)
            </Text>
          )}
        </Text>
        <JsonViewer
          data={event.payload}
          previousData={previousEvent?.payload}
          maxHeight="calc(100vh - 380px)"
        />
      </Box>
    </VStack>
  );
}
