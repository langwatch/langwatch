import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Badge,
  Box,
  Button,
  Card,
  Center,
  EmptyState,
  HStack,
  Input,
  Spinner,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import {
  ArrowLeft,
  ChevronRight,
  Circle,
  Eye,
  Keyboard,
  Search,
} from "lucide-react";
import { useRouter } from "next/router";
import { DashboardLayout } from "~/components/DashboardLayout";
import { useOpsPermission } from "~/hooks/useOpsPermission";
import { api } from "~/utils/api";
import { JsonViewer } from "~/components/ops/JsonViewer";

type AggregateResult = {
  aggregateId: string;
  aggregateType: string;
  tenantId: string;
  eventCount: number;
  lastEventTime: string;
};

type EventResult = {
  eventId: string;
  eventType: string;
  eventTimestamp: string;
  payload: unknown;
};

const EVENT_TYPE_COLORS = [
  "blue",
  "green",
  "purple",
  "orange",
  "cyan",
  "pink",
  "teal",
  "yellow",
  "red",
] as const;

function hashEventTypeColor(eventType: string): string {
  let hash = 0;
  for (let i = 0; i < eventType.length; i++) {
    hash = (hash << 5) - hash + eventType.charCodeAt(i);
    hash |= 0;
  }
  const idx = Math.abs(hash) % EVENT_TYPE_COLORS.length;
  return EVENT_TYPE_COLORS[idx]!;
}

function formatTimestamp(ts: string) {
  try {
    const date = new Date(parseInt(ts, 10));
    if (isNaN(date.getTime())) return ts;
    return date.toISOString().replace("T", " ").replace("Z", "");
  } catch {
    return ts;
  }
}

export default function OpsDejaViewPage() {
  const router = useRouter();
  const { hasAccess, isLoading: opsLoading } = useOpsPermission();

  useEffect(() => {
    if (!opsLoading && !hasAccess) {
      void router.push("/");
    }
  }, [hasAccess, opsLoading, router]);

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

  if (opsLoading || !hasAccess) return null;

  if (!selectedAggregate) {
    return (
      <DashboardLayout>
        <SearchHeader />
        <Box paddingX={6} paddingY={4} w="full">
          <VStack align="stretch" gap={4}>
            <Card.Root>
              <Card.Body padding={4}>
                <VStack align="stretch" gap={3}>
                  <Text textStyle="sm" fontWeight="medium">
                    Search Aggregates
                  </Text>
                  <HStack gap={2}>
                    <Input
                      size="sm"
                      placeholder="Search by aggregate ID or tenant ID..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSearch();
                      }}
                      flex={1}
                    />
                    <Input
                      size="sm"
                      placeholder="Tenant ID filter (optional)"
                      value={tenantFilter}
                      onChange={(e) => setTenantFilter(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSearch();
                      }}
                      width="250px"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleSearch}
                      loading={searchResults.isFetching}
                    >
                      <Search size={14} />
                      Search
                    </Button>
                  </HStack>
                </VStack>
              </Card.Body>
            </Card.Root>

            {searchResults.isFetching && !searchResults.data && (
              <Center paddingY={10}>
                <Spinner size="lg" />
              </Center>
            )}

            {searchResults.error && (
              <Card.Root borderColor="red.200" borderWidth="1px">
                <Card.Body padding={4}>
                  <Text textStyle="sm" color="red.500">
                    {searchResults.error.message}
                  </Text>
                </Card.Body>
              </Card.Root>
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

function SearchHeader() {
  return (
    <HStack
      height="48px"
      flexShrink={0}
      paddingX={6}
      width="full"
      borderBottom="1px solid"
      borderBottomColor="border"
      gap={2}
      position="sticky"
      top={0}
      zIndex={10}
      background="bg.surface"
    >
      <Text textStyle="md" fontWeight="semibold">
        Deja View
      </Text>
    </HStack>
  );
}

function ReplayHeader({
  aggregateId,
  tenantId,
  eventCursor,
  eventCount,
  onBack,
}: {
  aggregateId: string;
  tenantId: string;
  eventCursor: number;
  eventCount: number;
  onBack: () => void;
}) {
  return (
    <HStack
      height="48px"
      flexShrink={0}
      paddingX={4}
      width="full"
      borderBottom="1px solid"
      borderBottomColor="border"
      gap={3}
      background="bg.surface"
    >
      <Button size="xs" variant="ghost" onClick={onBack}>
        <ArrowLeft size={14} />
        Back
      </Button>
      <Box height="20px" width="1px" bg="border" />
      <HStack gap={2}>
        <Text textStyle="xs" color="fg.muted">
          Aggregate:
        </Text>
        <Text textStyle="xs" fontFamily="mono" fontWeight="medium">
          {aggregateId}
        </Text>
      </HStack>
      <Box height="20px" width="1px" bg="border" />
      <HStack gap={2}>
        <Text textStyle="xs" color="fg.muted">
          Tenant:
        </Text>
        <Badge size="sm" variant="subtle">
          {tenantId}
        </Badge>
      </HStack>
      <Box flex={1} />
      <Badge size="sm" variant="outline" colorPalette="blue">
        Event {eventCount > 0 ? eventCursor + 1 : 0} / {eventCount}
      </Badge>
    </HStack>
  );
}

function LeftPanel({
  projections,
  reactors,
  selectedProjection,
  onSelectProjection,
  currentEventType,
}: {
  projections: Array<{
    projectionName: string;
    pipelineName: string;
    aggregateType: string;
  }>;
  reactors: Array<{
    reactorName: string;
    pipelineName: string;
    aggregateType: string;
    afterProjection: string;
  }>;
  selectedProjection: string | null;
  onSelectProjection: (name: string | null) => void;
  currentEventType: string | null;
}) {
  return (
    <Box
      width="280px"
      minWidth="280px"
      borderRight="1px solid"
      borderRightColor="border"
      overflowY="auto"
      bg="bg.surface"
    >
      <VStack align="stretch" gap={0}>
        <Box paddingX={3} paddingY={2} borderBottom="1px solid" borderBottomColor="border">
          <Text textStyle="xs" fontWeight="semibold" color="fg.muted" textTransform="uppercase" letterSpacing="wider">
            Fold Projections
          </Text>
        </Box>

        {projections.length === 0 ? (
          <Box paddingX={3} paddingY={4}>
            <Text textStyle="xs" color="fg.muted">
              No projections for this aggregate type.
            </Text>
          </Box>
        ) : (
          projections.map((proj) => {
            const isSelected = selectedProjection === proj.projectionName;
            return (
              <Box
                key={proj.projectionName}
                paddingX={3}
                paddingY={2}
                cursor="pointer"
                bg={isSelected ? "bg.emphasized" : "transparent"}
                _hover={{ bg: isSelected ? "bg.emphasized" : "bg.muted" }}
                borderBottom="1px solid"
                borderBottomColor="border"
                onClick={() =>
                  onSelectProjection(
                    isSelected ? null : proj.projectionName,
                  )
                }
              >
                <HStack gap={2}>
                  <Circle
                    size={8}
                    fill="currentColor"
                    color="green.500"
                  />
                  <VStack align="start" gap={0}>
                    <Text textStyle="xs" fontWeight="medium">
                      {proj.projectionName}
                    </Text>
                    <Text textStyle="xs" color="fg.muted">
                      {proj.pipelineName}
                    </Text>
                  </VStack>
                </HStack>
              </Box>
            );
          })
        )}

        <Box
          paddingX={3}
          paddingY={2}
          borderBottom="1px solid"
          borderBottomColor="border"
          marginTop={2}
        >
          <Text textStyle="xs" fontWeight="semibold" color="fg.muted" textTransform="uppercase" letterSpacing="wider">
            Reactors
          </Text>
        </Box>
        {reactors.length === 0 ? (
          <Box paddingX={3} paddingY={4}>
            <Text textStyle="xs" color="fg.muted">
              No reactors for this aggregate type.
            </Text>
          </Box>
        ) : (
          reactors.map((reactor) => (
            <Box
              key={reactor.reactorName}
              paddingX={3}
              paddingY={2}
              borderBottom="1px solid"
              borderBottomColor="border"
            >
              <HStack gap={2}>
                <Circle
                  size={8}
                  fill="currentColor"
                  color="purple.500"
                />
                <VStack align="start" gap={0}>
                  <Text textStyle="xs" fontWeight="medium">
                    {reactor.reactorName}
                  </Text>
                  <Text textStyle="xs" color="fg.muted">
                    after {reactor.afterProjection}
                  </Text>
                </VStack>
              </HStack>
            </Box>
          ))
        )}
      </VStack>
    </Box>
  );
}

function CenterPanel({
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

function RightPanel({ event }: { event: EventResult }) {
  return (
    <Box
      width="400px"
      minWidth="400px"
      borderLeft="1px solid"
      borderLeftColor="border"
      overflow="hidden"
      display="flex"
      flexDirection="column"
    >
      <HStack
        paddingX={4}
        paddingY={2}
        borderBottom="1px solid"
        borderBottomColor="border"
        flexShrink={0}
        bg="bg.subtle"
      >
        <Text textStyle="xs" fontWeight="medium">
          Event Payload
        </Text>
        <Box flex={1} />
        <Text textStyle="xs" color="fg.muted">
          Press &apos;e&apos; to close
        </Text>
      </HStack>
      <Box flex={1} padding={4} overflow="auto">
        <JsonViewer data={event.payload} />
      </Box>
    </Box>
  );
}

function EventDetail({
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

function EventTimeline({
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

function KeyboardHints() {
  return (
    <HStack
      paddingX={4}
      paddingY={1}
      bg="bg.subtle"
      borderTop="1px solid"
      borderTopColor="border"
      gap={4}
      flexShrink={0}
    >
      <HStack gap={1}>
        <Keyboard size={10} />
        <Text textStyle="xs" color="fg.muted">
          Navigation:
        </Text>
      </HStack>
      <HStack gap={1}>
        <Kbd>←</Kbd>
        <Kbd>h</Kbd>
        <Text textStyle="xs" color="fg.muted">
          prev
        </Text>
      </HStack>
      <HStack gap={1}>
        <Kbd>→</Kbd>
        <Kbd>l</Kbd>
        <Text textStyle="xs" color="fg.muted">
          next
        </Text>
      </HStack>
      <HStack gap={1}>
        <Kbd>e</Kbd>
        <Text textStyle="xs" color="fg.muted">
          toggle event panel
        </Text>
      </HStack>
    </HStack>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <Box
      as="kbd"
      display="inline-flex"
      alignItems="center"
      justifyContent="center"
      paddingX={1}
      height="18px"
      minWidth="18px"
      borderRadius="sm"
      border="1px solid"
      borderColor="border"
      bg="bg.surface"
      fontSize="xs"
      fontFamily="mono"
      color="fg.muted"
    >
      {children}
    </Box>
  );
}

// --- URL fragment helpers ---

interface FragmentState {
  query?: string;
  tenant?: string;
  aggId?: string;
  aggTenant?: string;
  event?: number;
  proj?: string;
  detail?: boolean;
}

function parseFragment(url: string): FragmentState {
  const hash = url.split("#")[1];
  if (!hash) return {};
  try {
    const params = new URLSearchParams(hash);
    return {
      query: params.get("q") ?? undefined,
      tenant: params.get("t") ?? undefined,
      aggId: params.get("a") ?? undefined,
      aggTenant: params.get("at") ?? undefined,
      event: params.has("e") ? parseInt(params.get("e")!, 10) : undefined,
      proj: params.get("p") ?? undefined,
      detail: params.get("d") === "1",
    };
  } catch {
    return {};
  }
}

function buildFragment(state: FragmentState): string {
  const params = new URLSearchParams();
  if (state.query) params.set("q", state.query);
  if (state.tenant) params.set("t", state.tenant);
  if (state.aggId) params.set("a", state.aggId);
  if (state.aggTenant) params.set("at", state.aggTenant);
  if (state.event !== undefined) params.set("e", String(state.event));
  if (state.proj) params.set("p", state.proj);
  if (state.detail) params.set("d", "1");
  const str = params.toString();
  return str;
}

function AggregateTable({
  aggregates,
  onSelect,
}: {
  aggregates: AggregateResult[];
  onSelect: (aggregateId: string, tenantId: string) => void;
}) {
  return (
    <Card.Root overflow="hidden">
      <Table.ScrollArea>
        <Table.Root size="sm" variant="line">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>Aggregate ID</Table.ColumnHeader>
              <Table.ColumnHeader>Type</Table.ColumnHeader>
              <Table.ColumnHeader>Tenant</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">
                Event Count
              </Table.ColumnHeader>
              <Table.ColumnHeader>Last Event</Table.ColumnHeader>
              <Table.ColumnHeader />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {aggregates.map((agg) => (
              <Table.Row
                key={`${agg.tenantId}:${agg.aggregateId}`}
                cursor="pointer"
                _hover={{ bg: "bg.subtle" }}
                onClick={() => onSelect(agg.aggregateId, agg.tenantId)}
              >
                <Table.Cell>
                  <Text textStyle="xs" fontFamily="mono">
                    {agg.aggregateId}
                  </Text>
                </Table.Cell>
                <Table.Cell>
                  <Badge size="sm" variant="subtle">
                    {agg.aggregateType}
                  </Badge>
                </Table.Cell>
                <Table.Cell>
                  <Text textStyle="xs" fontFamily="mono" color="fg.muted">
                    {agg.tenantId}
                  </Text>
                </Table.Cell>
                <Table.Cell textAlign="end">
                  <Text textStyle="sm" fontWeight="medium">
                    {agg.eventCount}
                  </Text>
                </Table.Cell>
                <Table.Cell>
                  <Text textStyle="xs" color="fg.muted">
                    {formatTimestamp(agg.lastEventTime)}
                  </Text>
                </Table.Cell>
                <Table.Cell>
                  <ChevronRight size={14} />
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      </Table.ScrollArea>
    </Card.Root>
  );
}
