import { Badge, Box, Button, Center, HStack, Spinner, Text } from "@chakra-ui/react";
import { EventDetail } from "./deja-view.event-detail";
import { hashEventTypeColor } from "./deja-view.fragment";
import { JsonViewer } from "./json-viewer";
import type { EventResult } from "./deja-view.types";

export function DejaViewCenterPanel({
  currentEvent,
  previousEvent,
  eventCursor,
  selectedProjection,
  showDiff,
  onToggleDiff,
  projectionState,
  previousProjectionState,
  projectionStateLoading,
}: {
  currentEvent: EventResult | null;
  previousEvent: EventResult | null;
  eventCursor: number;
  selectedProjection: string | null;
  showDiff: boolean;
  onToggleDiff: () => void;
  projectionState: unknown;
  previousProjectionState: unknown;
  projectionStateLoading: boolean;
}) {
  if (!currentEvent) {
    return (
      <Box
        flex={1}
        minW={0}
        display="flex"
        alignItems="center"
        justifyContent="center"
        bg="bg.subtle"
      >
        <Text textStyle="sm" color="fg.muted">
          No event selected.
        </Text>
      </Box>
    );
  }

  if (selectedProjection) {
    return (
      <Box
        flex={1}
        minW={0}
        overflow="hidden"
        display="flex"
        flexDirection="column"
        bg="bg.subtle"
      >
        <HStack
          paddingX={4}
          paddingY={2}
          borderBottom="1px solid"
          borderBottomColor="border"
          flexShrink={0}
          bg="bg.surface"
        >
          <Text textStyle="xs" fontWeight="medium">
            {selectedProjection}
          </Text>
          <Text textStyle="xs" color="fg.muted">
            at event {eventCursor + 1}
          </Text>
          <Box flex={1} />
          <Button
            size="xs"
            variant={showDiff ? "subtle" : "ghost"}
            colorPalette={showDiff ? "orange" : "gray"}
            onClick={onToggleDiff}
          >
            Diff {showDiff ? "on" : "off"}
          </Button>
        </HStack>
        <Box flex={1} padding={4} overflow="auto">
          {projectionStateLoading ? (
            <Center paddingY={8}>
              <Spinner size="sm" />
            </Center>
          ) : projectionState != null ? (
            <JsonViewer
              data={projectionState}
              previousData={showDiff ? previousProjectionState : void 0}
              maxHeight="calc(100vh - 300px)"
            />
          ) : (
            <Text textStyle="xs" color="fg.muted">
              No projection state computed. This projection may not handle the events for
              this aggregate.
            </Text>
          )}
        </Box>
      </Box>
    );
  }

  return (
    <Box flex={1} overflow="hidden" display="flex" flexDirection="column" bg="bg.subtle">
      <HStack
        paddingX={4}
        paddingY={2}
        borderBottom="1px solid"
        borderBottomColor="border"
        flexShrink={0}
        bg="bg.surface"
      >
        <Text textStyle="xs" fontWeight="medium">
          Event Detail
        </Text>
        <Text textStyle="xs" color="fg.muted">
          #{eventCursor + 1}
        </Text>
        <Box flex={1} />
        <Button
          size="xs"
          variant={showDiff ? "subtle" : "ghost"}
          colorPalette={showDiff ? "orange" : "gray"}
          onClick={onToggleDiff}
        >
          Diff {showDiff ? "on" : "off"}
        </Button>
        <Badge
          size="sm"
          colorPalette={hashEventTypeColor(currentEvent.eventType)}
          variant="subtle"
        >
          {currentEvent.eventType}
        </Badge>
      </HStack>
      <Box flex={1} overflow="auto">
        <EventDetail
          event={currentEvent}
          previousEvent={showDiff ? previousEvent : null}
        />
      </Box>
    </Box>
  );
}
