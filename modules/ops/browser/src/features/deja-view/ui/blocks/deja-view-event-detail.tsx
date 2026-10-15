import { InlineCode } from "@langwatch/design-system/inline-code";
import { Badge, Box, HStack, Text, VStack } from "@langwatch/design-system/primitives";

import { JsonViewer } from "../../../../ui/elements/ops-json-viewer.tsx";
import { formatTimestamp, hashEventTypeColor } from "../../model/deja-view-fragment.ts";
import type { EventResult } from "../../model/deja-view-types.ts";

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
              <InlineCode variant="neutral">{event.eventId}</InlineCode>
            </VStack>
            <VStack align="start" gap={0}>
              <Text textStyle="xs" color="fg.muted">
                Type
              </Text>
              <Badge size="sm" colorPalette={hashEventTypeColor(event.eventType)} variant="subtle">
                {event.eventType}
              </Badge>
            </VStack>
            <VStack align="start" gap={0}>
              <Text textStyle="xs" color="fg.muted">
                Timestamp
              </Text>
              <InlineCode variant="neutral">{formatTimestamp(event.eventTimestamp)}</InlineCode>
            </VStack>
          </HStack>
        </VStack>
      </Box>
      <Box padding={4}>
        <Text textStyle="xs" fontWeight="medium" marginBottom={2}>
          Payload
          {previousEvent && (
            <Text as="span" color="orange.fg" marginLeft={2}>
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
