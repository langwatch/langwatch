import { Box, Center, EmptyState, HStack, Spinner, Text, VStack } from "@chakra-ui/react";
import { Eye, Info } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { AggregateTable } from "../blocks/deja-view-aggregate-table";
import { DejaViewCenterPanel } from "./deja-view-center-panel";
import { EventTimeline } from "../blocks/deja-view-event-timeline";
import { DejaViewKeyboardHints } from "../elements/deja-view-keyboard-hints";
import { LeftPanel } from "../elements/deja-view-left-panel";
import { DejaViewManagerPanel } from "../blocks/deja-view-manager-panel";
import type { DejaViewProcessManager } from "../blocks/deja-view-manager-card";
import { ReplayHeader } from "../elements/deja-view-replay-header";
import { RightPanel } from "../blocks/deja-view-right-panel";
import { SearchHeader } from "../elements/deja-view-search-header";
import type { AggregateResult, EventResult } from "../../model/deja-view-types";

type AggregateSelection = { aggregateId: string; tenantId: string } | null;
type Projection = {
  projectionName: string;
  pipelineName: string;
  aggregateType: string;
};
type EventSubscriber = {
  subscriberName: string;
  pipelineName: string;
  aggregateType: string;
  eventTypes: readonly string[];
};

/**
 * Controlled DejaView workspace. The app supplies the transport results and
 * URL-owned state; this package owns the complete operator-facing browser
 * surface and its presentation transitions.
 */
export function DejaView({
  searchQuery,
  tenantFilter,
  hasSearched,
  searchResults,
  searchLoading,
  searchError,
  searchLookbackDays,
  hotTierDays,
  hotTierEnvVar,
  selectedAggregate,
  events,
  eventsLoading,
  eventsError,
  eventCursor,
  selectedProjection,
  showEventDetail,
  showDiff,
  matchingProjections,
  matchingEventSubscribers,
  projectionState,
  previousProjectionState,
  projectionStateLoading,
  managers,
  managersLoading,
  managersError,
  renderKey,
  onSearchQueryChange,
  onTenantFilterChange,
  onSearch,
  onSelectAggregate,
  onBack,
  onSelectProjection,
  onToggleDiff,
  onToggleEventDetail,
  onSelectEvent,
}: {
  searchQuery: string;
  tenantFilter: string;
  hasSearched: boolean;
  searchResults: AggregateResult[] | undefined;
  searchLoading: boolean;
  searchError?: ReactNode;
  searchLookbackDays: number | null;
  hotTierDays: number | null;
  hotTierEnvVar: string | null;
  selectedAggregate: AggregateSelection;
  events: EventResult[];
  eventsLoading: boolean;
  eventsError?: ReactNode;
  eventCursor: number;
  selectedProjection: string | null;
  showEventDetail: boolean;
  showDiff: boolean;
  matchingProjections: Projection[];
  matchingEventSubscribers: EventSubscriber[];
  projectionState: unknown;
  previousProjectionState: unknown;
  projectionStateLoading: boolean;
  managers: DejaViewProcessManager[];
  managersLoading: boolean;
  managersError: string | null;
  renderKey: (label: string) => ReactNode;
  onSearchQueryChange: (value: string) => void;
  onTenantFilterChange: (value: string) => void;
  onSearch: () => void;
  onSelectAggregate: (aggregateId: string, tenantId: string) => void;
  onBack: () => void;
  onSelectProjection: (name: string | null) => void;
  onToggleDiff: () => void;
  onToggleEventDetail: () => void;
  onSelectEvent: (index: number) => void;
}) {
  useEffect(() => {
    if (!selectedAggregate || events.length === 0) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return;
      }

      switch (event.key) {
        case "ArrowLeft":
        case "h":
          event.preventDefault();
          onSelectEvent(Math.max(0, eventCursor - 1));
          break;
        case "ArrowRight":
        case "l":
          event.preventDefault();
          onSelectEvent(Math.min(events.length - 1, eventCursor + 1));
          break;
        case "e":
          event.preventDefault();
          onToggleEventDetail();
          break;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedAggregate, events.length, eventCursor, onSelectEvent, onToggleEventDetail]);

  if (!selectedAggregate) {
    return (
      <>
        <SearchHeader
          searchQuery={searchQuery}
          tenantFilter={tenantFilter}
          onSearchQueryChange={onSearchQueryChange}
          onTenantFilterChange={onTenantFilterChange}
          onSearch={onSearch}
          isLoading={searchLoading}
        />
        <Box paddingX={6} paddingY={4} w="full">
          <VStack align="stretch" gap={4}>
            {searchLookbackDays !== null && (
              <Box
                padding={3}
                borderRadius="md"
                borderWidth="1px"
                borderColor="border.muted"
                bg="bg.muted"
              >
                <HStack gap={2} align="start">
                  <Box color="fg.muted" paddingTop={0.5}>
                    <Info size={14} />
                  </Box>
                  <Text textStyle="xs" color="fg.muted">
                    Search is bounded to the last {searchLookbackDays} days.
                    {hotTierDays !== null && (
                      <>
                        {" "}
                        Aggregates older than {hotTierDays} days within that window live in cold
                        storage and load quite some slower (set by{" "}
                        {hotTierEnvVar ?? "CLICKHOUSE_COLD_STORAGE_EVENT_LOG_TTL_DAYS"}).
                      </>
                    )}
                  </Text>
                </HStack>
              </Box>
            )}

            {searchLoading && !searchResults && (
              <Center paddingY={10}>
                <Spinner size="lg" />
              </Center>
            )}

            {searchError}

            {hasSearched && !searchLoading && searchResults && searchResults.length === 0 && (
              <Center paddingY={10}>
                <EmptyState.Root>
                  <EmptyState.Content>
                    <EmptyState.Indicator>
                      <Eye size={32} />
                    </EmptyState.Indicator>
                    <EmptyState.Title>No aggregates found</EmptyState.Title>
                    <EmptyState.Description>
                      No aggregates match your search criteria. Try a different query or tenant ID.
                    </EmptyState.Description>
                  </EmptyState.Content>
                </EmptyState.Root>
              </Center>
            )}

            {!hasSearched && (
              <Center paddingY={10}>
                <Text textStyle="sm" color="fg.muted">
                  Search for an aggregate ID to get started.
                </Text>
              </Center>
            )}

            {searchResults && searchResults.length > 0 && (
              <AggregateTable aggregates={searchResults} onSelect={onSelectAggregate} />
            )}
          </VStack>
        </Box>
      </>
    );
  }

  return (
    <Box
      display="flex"
      flexDirection="column"
      height="calc(100vh - 56px)"
      overflow="hidden"
      w="full"
      borderTopLeftRadius="xl"
    >
      <ReplayHeader
        aggregateId={selectedAggregate.aggregateId}
        tenantId={selectedAggregate.tenantId}
        eventCursor={eventCursor}
        eventCount={events.length}
        onBack={onBack}
      />

      {eventsLoading ? (
        <Center flex={1}>
          <Spinner size="lg" />
        </Center>
      ) : eventsError ? (
        <Center flex={1}>{eventsError}</Center>
      ) : events.length === 0 ? (
        <Center flex={1}>
          <Text textStyle="sm" color="fg.muted">
            No events found for this aggregate.
          </Text>
        </Center>
      ) : (
        <>
          <Box display="flex" flex={1} overflow="hidden" minH={0} w="full">
            <LeftPanel
              projections={matchingProjections}
              eventSubscribers={matchingEventSubscribers}
              selectedProjection={selectedProjection}
              onSelectProjection={onSelectProjection}
            />

            <DejaViewCenterPanel
              currentEvent={events[eventCursor] ?? null}
              previousEvent={eventCursor > 0 ? (events[eventCursor - 1] ?? null) : null}
              eventCursor={eventCursor}
              selectedProjection={selectedProjection}
              showDiff={showDiff}
              onToggleDiff={onToggleDiff}
              projectionState={projectionState}
              previousProjectionState={previousProjectionState}
              projectionStateLoading={projectionStateLoading}
            />

            {selectedProjection && showEventDetail && events[eventCursor] && (
              <RightPanel event={events[eventCursor]} />
            )}

            <DejaViewManagerPanel
              managers={managers}
              isLoading={managersLoading}
              errorMessage={managersError}
            />
          </Box>

          <EventTimeline
            events={events}
            eventCursor={eventCursor}
            onSelectEvent={onSelectEvent}
            eventTypes={[...new Set(events.map((event) => event.eventType))]}
          />

          <DejaViewKeyboardHints renderKey={renderKey} />
        </>
      )}
    </Box>
  );
}
