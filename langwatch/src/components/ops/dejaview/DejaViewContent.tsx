import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Box,
  Center,
  EmptyState,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Eye } from "lucide-react";
import { useRouter } from "next/router";
import { DashboardLayout } from "~/components/DashboardLayout";
import { api } from "~/utils/api";
import { parseFragment, buildFragment } from "./fragment";
import { SearchHeader } from "./SearchHeader";
import { ReplayHeader } from "./ReplayHeader";
import { LeftPanel } from "./LeftPanel";
import { CenterPanel } from "./CenterPanel";
import { RightPanel } from "./RightPanel";
import { EventTimeline } from "./EventTimeline";
import { KeyboardHints } from "./KeyboardHints";
import { AggregateTable } from "./AggregateTable";
import type { EventResult } from "./types";

export function DejaViewContent() {
  const router = useRouter();

  // Read initial state from URL fragment
  const initialState = useMemo(() => parseFragment(router.asPath), []);

  // When arriving via deep link with aggregate but no query, auto-search to resolve aggregate type
  const deepLinkedAgg = initialState.aggId && initialState.aggTenant && !initialState.query;
  const [searchQuery, setSearchQuery] = useState(initialState.query ?? (deepLinkedAgg ? initialState.aggId! : ""));
  const [tenantFilter, setTenantFilter] = useState(initialState.tenant ?? (deepLinkedAgg ? initialState.aggTenant! : ""));
  const [submittedQuery, setSubmittedQuery] = useState(initialState.query ?? (deepLinkedAgg ? initialState.aggId! : ""));
  const [submittedTenant, setSubmittedTenant] = useState(initialState.tenant ?? (deepLinkedAgg ? initialState.aggTenant! : ""));
  const [hasSearched, setHasSearched] = useState(!!initialState.query || !!deepLinkedAgg);

  const [selectedAggregate, setSelectedAggregate] = useState<{
    aggregateId: string;
    tenantId: string;
  } | null>(
    initialState.aggId && initialState.aggTenant
      ? { aggregateId: initialState.aggId, tenantId: initialState.aggTenant }
      : null
  );

  const [eventCursor, setEventCursor] = useState(initialState.event ?? 0);
  const [selectedProjection, setSelectedProjection] = useState<string | null>(
    initialState.proj ?? null,
  );
  const [showEventDetail, setShowEventDetail] = useState(initialState.detail ?? false);
  const [showDiff, setShowDiff] = useState(true);

  // Sync state to URL fragment
  useEffect(() => {
    const fragment = buildFragment({
      query: submittedQuery || undefined,
      tenant: submittedTenant || undefined,
      aggId: selectedAggregate?.aggregateId,
      aggTenant: selectedAggregate?.tenantId,
      event: selectedAggregate ? eventCursor : undefined,
      proj: selectedProjection ?? undefined,
      detail: showEventDetail || undefined,
    });
    const url = router.asPath.split("#")[0] + (fragment ? `#${fragment}` : "");
    window.history.replaceState(null, "", url);
  }, [submittedQuery, submittedTenant, selectedAggregate, eventCursor, selectedProjection, showEventDetail, router.asPath]);

  const searchResults = api.ops.searchAggregates.useQuery(
    {
      query: submittedQuery,
      tenantId: submittedTenant || undefined,
    },
    {
      enabled: hasSearched,
    },
  );

  const eventsQuery = api.ops.loadAggregateEvents.useQuery(
    {
      aggregateId: selectedAggregate?.aggregateId ?? "",
      tenantId: selectedAggregate?.tenantId ?? "",
    },
    {
      enabled: !!selectedAggregate,
    },
  );

  const projectionsQuery = api.ops.listProjections.useQuery(undefined, {
    enabled: !!selectedAggregate,
  });

  const events: EventResult[] = eventsQuery.data ?? [];
  const currentEvent = events[eventCursor] ?? null;
  const previousEvent = eventCursor > 0 ? events[eventCursor - 1] ?? null : null;

  const currentAggregateType = useMemo(() => {
    if (!searchResults.data || !selectedAggregate) return null;
    const agg = searchResults.data.find(
      (a) =>
        a.aggregateId === selectedAggregate.aggregateId &&
        a.tenantId === selectedAggregate.tenantId,
    );
    return agg?.aggregateType ?? null;
  }, [searchResults.data, selectedAggregate]);

  const matchingProjections = useMemo(() => {
    if (!projectionsQuery.data || !currentAggregateType) return [];
    return projectionsQuery.data.projections.filter(
      (p) => p.aggregateType === currentAggregateType,
    );
  }, [projectionsQuery.data, currentAggregateType]);

  const matchingReactors = useMemo(() => {
    if (!projectionsQuery.data || !currentAggregateType) return [];
    return projectionsQuery.data.reactors.filter(
      (r) => r.aggregateType === currentAggregateType,
    );
  }, [projectionsQuery.data, currentAggregateType]);

  const eventTypes = useMemo(() => {
    const types = new Set<string>();
    for (const e of events) {
      types.add(e.eventType);
    }
    return [...types];
  }, [events]);

  function handleSearch() {
    setSubmittedQuery(searchQuery);
    setSubmittedTenant(tenantFilter);
    setHasSearched(true);
    setSelectedAggregate(null);
    setEventCursor(0);
    setSelectedProjection(null);
    setShowEventDetail(false);
  }

  function handleSelectAggregate(aggregateId: string, tenantId: string) {
    setSelectedAggregate({ aggregateId, tenantId });
    setEventCursor(0);
    setSelectedProjection(null);
    setShowEventDetail(false);
  }

  function handleBack() {
    setSelectedAggregate(null);
    setEventCursor(0);
    setSelectedProjection(null);
    setShowEventDetail(false);
  }

  const navigateEvent = useCallback(
    (direction: "prev" | "next") => {
      setEventCursor((curr) => {
        if (direction === "prev") return Math.max(0, curr - 1);
        return Math.min(events.length - 1, curr + 1);
      });
    },
    [events.length],
  );

  useEffect(() => {
    if (!selectedAggregate || events.length === 0) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      switch (e.key) {
        case "ArrowLeft":
        case "h":
          e.preventDefault();
          navigateEvent("prev");
          break;
        case "ArrowRight":
        case "l":
          e.preventDefault();
          navigateEvent("next");
          break;
        case "e":
          e.preventDefault();
          setShowEventDetail((prev) => !prev);
          break;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedAggregate, events.length, navigateEvent]);

  if (!selectedAggregate) {
    return (
      <DashboardLayout>
        <SearchHeader
          searchQuery={searchQuery}
          tenantFilter={tenantFilter}
          onSearchQueryChange={setSearchQuery}
          onTenantFilterChange={setTenantFilter}
          onSearch={handleSearch}
          isLoading={searchResults.isFetching}
        />
        <Box paddingX={6} paddingY={4} w="full">
          <VStack align="stretch" gap={4}>
            {searchResults.isFetching && !searchResults.data && (
              <Center paddingY={10}>
                <Spinner size="lg" />
              </Center>
            )}

            {searchResults.error && (
              <Box
                padding={4}
                borderRadius="md"
                borderWidth="1px"
                borderColor="red.200"
              >
                <Text textStyle="sm" color="red.500">
                  {searchResults.error.message}
                </Text>
              </Box>
            )}

            {hasSearched &&
              !searchResults.isFetching &&
              searchResults.data &&
              searchResults.data.length === 0 && (
                <Center paddingY={10}>
                  <EmptyState.Root>
                    <EmptyState.Content>
                      <EmptyState.Indicator>
                        <Eye size={32} />
                      </EmptyState.Indicator>
                      <EmptyState.Title>No aggregates found</EmptyState.Title>
                      <EmptyState.Description>
                        No aggregates match your search criteria. Try a
                        different query or tenant ID.
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

            {searchResults.data && searchResults.data.length > 0 && (
              <AggregateTable
                aggregates={searchResults.data}
                onSelect={handleSelectAggregate}
              />
            )}
          </VStack>
        </Box>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
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
          onBack={handleBack}
        />

        {eventsQuery.isLoading ? (
          <Center flex={1}>
            <Spinner size="lg" />
          </Center>
        ) : eventsQuery.error ? (
          <Center flex={1}>
            <Text textStyle="sm" color="red.500">
              {eventsQuery.error.message}
            </Text>
          </Center>
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
                reactors={matchingReactors}
                selectedProjection={selectedProjection}
                onSelectProjection={setSelectedProjection}
                currentEventType={currentEvent?.eventType ?? null}
              />

              <CenterPanel
                currentEvent={currentEvent}
                previousEvent={previousEvent}
                eventCursor={eventCursor}
                selectedProjection={selectedProjection}
                showDiff={showDiff}
                onToggleDiff={() => setShowDiff((d) => !d)}
                aggregateId={selectedAggregate?.aggregateId ?? ""}
                tenantId={selectedAggregate?.tenantId ?? ""}
              />

              {selectedProjection && showEventDetail && currentEvent && (
                <RightPanel event={currentEvent} />
              )}
            </Box>

            <EventTimeline
              events={events}
              eventCursor={eventCursor}
              onSelectEvent={setEventCursor}
              eventTypes={eventTypes}
            />

            <KeyboardHints />
          </>
        )}
      </Box>
    </DashboardLayout>
  );
}
