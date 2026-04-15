import { Badge, Box, Button, Center, HStack, Spinner, Text } from "@chakra-ui/react";
import { JsonViewer } from "~/components/ops/JsonViewer";
import { api } from "~/utils/api";
import { hashEventTypeColor } from "./fragment";
import { EventDetail } from "./EventDetail";
import type { EventResult } from "./types";

export function CenterPanel({
  currentEvent,
  previousEvent,
  eventCursor,
  selectedProjection,
  showDiff,
  onToggleDiff,
  aggregateId,
  tenantId,
}: {
  currentEvent: EventResult | null;
  previousEvent: EventResult | null;
  eventCursor: number;
  selectedProjection: string | null;
  showDiff: boolean;
  onToggleDiff: () => void;
  aggregateId: string;
  tenantId: string;
}) {
  const projectionStateQuery = api.ops.computeProjectionState.useQuery(
    {
      aggregateId,
      tenantId,
      projectionName: selectedProjection ?? "",
      eventIndex: eventCursor,
    },
    {
      enabled: !!selectedProjection && !!aggregateId && !!tenantId,
    },
  );

  const prevProjectionStateQuery = api.ops.computeProjectionState.useQuery(
    {
      aggregateId,
      tenantId,
      projectionName: selectedProjection ?? "",
      eventIndex: Math.max(0, eventCursor - 1),
    },
    {
      enabled: !!selectedProjection && !!aggregateId && !!tenantId && showDiff && eventCursor > 0,
    },
  );

  if (!currentEvent) {
    return (
      <Box flex={1} minW={0} display="flex" alignItems="center" justifyContent="center" bg="bg.subtle">
        <Text textStyle="sm" color="fg.muted">
          No event selected.
        </Text>
      </Box>
    );
  }

  if (selectedProjection) {
    const state = projectionStateQuery.data?.state;
    const prevState = showDiff ? prevProjectionStateQuery.data?.state : undefined;

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
          <Button size="xs" variant={showDiff ? "subtle" : "ghost"} colorPalette={showDiff ? "orange" : "gray"} onClick={onToggleDiff}>
            Diff {showDiff ? "on" : "off"}
          </Button>
        </HStack>
        <Box flex={1} padding={4} overflow="auto">
          {projectionStateQuery.isLoading ? (
            <Center paddingY={8}>
              <Spinner size="sm" />
            </Center>
          ) : state != null ? (
            <JsonViewer
              data={state}
              previousData={showDiff && prevState != null ? prevState : undefined}
              maxHeight="calc(100vh - 300px)"
            />
          ) : (
            <Text textStyle="xs" color="fg.muted">
              No projection state computed. This projection may not handle the events for this aggregate.
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
        <Button size="xs" variant={showDiff ? "subtle" : "ghost"} colorPalette={showDiff ? "orange" : "gray"} onClick={onToggleDiff}>
          Diff {showDiff ? "on" : "off"}
        </Button>
        <Badge size="sm" colorPalette={hashEventTypeColor(currentEvent.eventType)} variant="subtle">
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
