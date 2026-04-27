import { useEffect, useRef } from "react";
import { Box, HStack, Text } from "@chakra-ui/react";
import { hashEventTypeColor, formatTimestamp } from "./fragment";
import type { EventResult } from "./types";

export function EventTimeline({
  events,
  eventCursor,
  onSelectEvent,
  eventTypes,
}: {
  events: EventResult[];
  eventCursor: number;
  onSelectEvent: (index: number) => void;
  eventTypes: string[];
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (activeRef.current && scrollRef.current) {
      const container = scrollRef.current;
      const element = activeRef.current;
      const containerRect = container.getBoundingClientRect();
      const elementRect = element.getBoundingClientRect();

      if (
        elementRect.left < containerRect.left ||
        elementRect.right > containerRect.right
      ) {
        element.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
          inline: "center",
        });
      }
    }
  }, [eventCursor]);

  return (
    <Box
      borderTop="1px solid"
      borderTopColor="border"
      bg="bg.subtle"
      flexShrink={0}
    >
      <HStack paddingX={3} paddingY={1} gap={2} borderBottom="1px solid" borderBottomColor="border">
        <Text textStyle="xs" color="fg.muted" fontWeight="medium" flexShrink={0}>
          Timeline
        </Text>
        <Box flex={1} />
        <HStack gap={2} flexWrap="wrap">
          {eventTypes.map((type) => (
            <HStack key={type} gap={1}>
              <Box
                width="8px"
                height="8px"
                borderRadius="sm"
                bg={`${hashEventTypeColor(type)}.500`}
              />
              <Text textStyle="xs" color="fg.muted">
                {type}
              </Text>
            </HStack>
          ))}
        </HStack>
      </HStack>
      <Box
        ref={scrollRef}
        overflowX="auto"
        paddingX={3}
        paddingY={2}
        css={{
          "&::-webkit-scrollbar": {
            height: "6px",
          },
          "&::-webkit-scrollbar-track": {
            background: "transparent",
          },
          "&::-webkit-scrollbar-thumb": {
            borderRadius: "3px",
          },
        }}
      >
        <HStack gap={1} minWidth="max-content">
          {events.map((event, idx) => {
            const isCurrent = idx === eventCursor;
            const color = hashEventTypeColor(event.eventType);

            return (
              <Box
                key={event.eventId}
                ref={isCurrent ? activeRef : undefined}
                width="36px"
                height="28px"
                borderRadius="sm"
                display="flex"
                alignItems="center"
                justifyContent="center"
                cursor="pointer"
                bg={isCurrent ? `${color}.500` : `${color}.500/20`}
                color={isCurrent ? "white" : `${color}.500`}
                border={isCurrent ? "2px solid" : "1px solid"}
                borderColor={isCurrent ? `${color}.300` : `${color}.500/30`}
                fontFamily="mono"
                fontSize="xs"
                fontWeight={isCurrent ? "bold" : "normal"}
                _hover={{
                  bg: isCurrent ? `${color}.500` : `${color}.500/40`,
                }}
                onClick={() => onSelectEvent(idx)}
                title={`${event.eventType} - ${formatTimestamp(event.eventTimestamp)}`}
                flexShrink={0}
              >
                {idx + 1}
              </Box>
            );
          })}
        </HStack>
      </Box>
    </Box>
  );
}
