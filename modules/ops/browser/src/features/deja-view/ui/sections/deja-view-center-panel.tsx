import { Badge, Box, Button, Center, HStack, Spinner, Text } from "@chakra-ui/react";
import { EventDetail } from "../blocks/deja-view-event-detail.tsx";
import { hashEventTypeColor } from "../../model/deja-view-fragment.ts";
import { JsonViewer } from "../../../../ui/elements/ops-json-viewer.tsx";
import type { EventResult } from "../../model/deja-view-types.ts";

/** The replayed projection state, while it loads and when there is none. */
function ProjectionStateBody({
  loading,
  state,
  previousState,
}: {
  loading: boolean;
  state: unknown;
  previousState: unknown;
}) {
  if (loading) {
    return (
      <Center paddingY={8}>
        <Spinner size="sm" />
      </Center>
    );
  }
  if (state == null) {
    return (
      <Text textStyle="xs" color="fg.muted">
        No projection state computed. This projection may not handle the events for this aggregate.
      </Text>
    );
  }
  return <JsonViewer data={state} previousData={previousState} maxHeight="calc(100vh - 300px)" />;
}

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
      <Box flex={1} minW={0} overflow="hidden" display="flex" flexDirection="column" bg="bg.subtle">
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
          <ProjectionStateBody
            loading={projectionStateLoading}
            state={projectionState}
            previousState={showDiff ? previousProjectionState : void 0}
          />
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
        <Badge size="sm" colorPalette={hashEventTypeColor(currentEvent.eventType)} variant="subtle">
          {currentEvent.eventType}
        </Badge>
      </HStack>
      <Box flex={1} overflow="auto">
        <EventDetail event={currentEvent} previousEvent={showDiff ? previousEvent : null} />
      </Box>
    </Box>
  );
}
