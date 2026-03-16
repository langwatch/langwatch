import {
  Box,
  Button,
  Flex,
  Text,
  Input,
  InputGroup,
  InputLeftElement,
  Spinner,
  VStack,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  Badge,
  IconButton,
  Tooltip,
} from "@chakra-ui/react";
import { SearchIcon, ArrowBackIcon, WarningIcon } from "@chakra-ui/icons";
import { useState, useEffect, useCallback, useRef, type RefObject } from "react";
import { useSearchParams } from "react-router-dom";
import { useDejaViewData } from "../hooks/useDejaViewData.ts";
import { EventTimeline } from "../components/dejaview/EventTimeline.tsx";
import { EventDetail } from "../components/dejaview/EventDetail.tsx";
import { JsonViewer } from "../components/dejaview/JsonViewer.tsx";
import type { ProjectionMeta, HandlerMeta } from "../../shared/dejaview.types.ts";

export function DejaViewPage() {
  const {
    aggregates,
    aggregatesLoading,
    aggregatesError,
    replay,
    replayLoading,
    replayError,
    eventCursor,
    selectedProjectionId,
    projectionState,
    projectionStateLoading,
    showEventDetail,
    fetchAggregates,
    loadReplay,
    setEventCursor,
    selectProjection,
  } = useDejaViewData();

  const [searchParams, setSearchParams] = useSearchParams();
  const selectedAggregateId = searchParams.get("aggregateId");
  const selectedTenantId = searchParams.get("tenantId");

  const [searchQuery, setSearchQuery] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const initialLoadDone = useRef(false);

  // Initial load — fetch aggregates or auto-load replay from URL params
  useEffect(() => {
    if (initialLoadDone.current) return;
    initialLoadDone.current = true;

    if (selectedAggregateId && selectedTenantId) {
      loadReplay(selectedAggregateId, selectedTenantId);
    } else {
      fetchAggregates(undefined);
    }
  }, [selectedAggregateId, selectedTenantId, fetchAggregates, loadReplay]);

  // Cleanup debounce on unmount
  useEffect(() => {
    const ref = debounceRef as RefObject<ReturnType<typeof setTimeout> | undefined>;
    return () => clearTimeout(ref.current);
  }, []);

  // Debounced search
  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchQuery(value);
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        fetchAggregates(value || undefined);
      }, 300);
    },
    [fetchAggregates]
  );

  const handleSelectAggregate = useCallback(
    (aggregateId: string, tenantId: string) => {
      setSearchParams({ aggregateId, tenantId });
      loadReplay(aggregateId, tenantId);
    },
    [loadReplay, setSearchParams]
  );

  const handleLoadAll = useCallback(() => {
    if (selectedAggregateId && selectedTenantId) {
      loadReplay(selectedAggregateId, selectedTenantId, true);
    }
  }, [selectedAggregateId, selectedTenantId, loadReplay]);

  const handleBack = useCallback(() => {
    setSearchParams({});
    fetchAggregates(searchQuery || undefined);
  }, [setSearchParams, fetchAggregates, searchQuery]);

  // Aggregate selection view
  if (!selectedAggregateId) {
    return (
      <Box p={6} maxW="900px" mx="auto">
        <Flex align="center" mb={6}>
          <Box>
            <Text fontSize="xl" fontWeight="bold" color="#00f0ff" textTransform="uppercase" letterSpacing="0.15em">
              Deja View
            </Text>
            <Text fontSize="xs" color="text.muted">
              Event Sourcing Time Travel Debugger
            </Text>
          </Box>
        </Flex>

        {/* Search */}
        <InputGroup mb={4}>
          <InputLeftElement>
            <SearchIcon color="text.muted" boxSize={3} />
          </InputLeftElement>
          <Input
            placeholder="Search by aggregate ID..."
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            bg="surface.input"
            borderColor="border.input"
            fontSize="sm"
            _focus={{ borderColor: "#00f0ff", boxShadow: "0 0 0 1px #00f0ff" }}
          />
        </InputGroup>

        {/* Error */}
        {aggregatesError && (
          <Box p={3} mb={4} borderWidth="1px" borderColor="rgba(255,0,51,0.3)" borderRadius="2px" bg="rgba(255,0,51,0.05)">
            <Text fontSize="sm" color="#ff0033">{aggregatesError}</Text>
          </Box>
        )}

        {/* Loading */}
        {aggregatesLoading && (
          <Flex justify="center" py={8}>
            <Spinner color="#00f0ff" size="md" />
          </Flex>
        )}

        {/* Results table */}
        {!aggregatesLoading && aggregates.length > 0 && (
          <Box borderWidth="1px" borderColor="border.subtle" borderRadius="2px" overflow="hidden">
            <Table size="sm" variant="simple">
              <Thead>
                <Tr>
                  <Th>Aggregate ID</Th>
                  <Th>Tenant</Th>
                  <Th>Type</Th>
                  <Th isNumeric>Events</Th>
                </Tr>
              </Thead>
              <Tbody>
                {aggregates.map((agg) => (
                  <Tr
                    key={`${agg.tenantId}:${agg.aggregateId}`}
                    cursor="pointer"
                    _hover={{ bg: "row.hover" }}
                    onClick={() => handleSelectAggregate(agg.aggregateId, agg.tenantId)}
                  >
                    <Td>
                      <Text fontSize="xs" color="text.primary" fontFamily="mono">
                        {agg.aggregateId}
                      </Text>
                    </Td>
                    <Td>
                      <Text fontSize="xs" color="text.muted" fontFamily="mono">
                        {agg.tenantId}
                      </Text>
                    </Td>
                    <Td>
                      <Badge fontSize="10px" bg="badge.pending" color="badge.pending.text">
                        {agg.aggregateType}
                      </Badge>
                    </Td>
                    <Td isNumeric>
                      <Flex align="center" justify="flex-end" gap={1}>
                        {agg.eventCount > 300 && (
                          <Tooltip label="Large aggregate — may load slowly" fontSize="xs">
                            <WarningIcon color="#ff9900" boxSize={3} />
                          </Tooltip>
                        )}
                        <Text fontSize="xs" color="text.secondary">{agg.eventCount}</Text>
                      </Flex>
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </Box>
        )}

        {!aggregatesLoading && aggregates.length === 0 && !aggregatesError && (
          <Flex justify="center" py={8}>
            <Text color="text.muted" fontSize="sm">
              {searchQuery ? "No aggregates match your search" : "No aggregates found"}
            </Text>
          </Flex>
        )}
      </Box>
    );
  }

  // Replay view
  if (replayLoading) {
    return (
      <Flex justify="center" align="center" h="calc(100vh - 60px)" direction="column" gap={3}>
        <Spinner color="#00f0ff" size="lg" />
        <Text color="text.muted" fontSize="sm">Loading events for {selectedAggregateId}...</Text>
      </Flex>
    );
  }

  if (replayError) {
    return (
      <Box p={6}>
        <IconButton
          aria-label="Back"
          icon={<ArrowBackIcon />}
          onClick={handleBack}
          variant="ghost"
          size="sm"
          color="text.secondary"
          mb={4}
        />
        <Box p={4} borderWidth="1px" borderColor="rgba(255,0,51,0.3)" borderRadius="2px" bg="rgba(255,0,51,0.05)">
          <Text color="#ff0033" fontWeight="bold" mb={1}>Error</Text>
          <Text fontSize="sm" color="#ff0033">{replayError}</Text>
        </Box>
      </Box>
    );
  }

  if (!replay || replay.events.length === 0) {
    return (
      <Box p={6}>
        <IconButton
          aria-label="Back"
          icon={<ArrowBackIcon />}
          onClick={handleBack}
          variant="ghost"
          size="sm"
          color="text.secondary"
          mb={4}
        />
        <Text color="text.muted">No events found for this aggregate.</Text>
      </Box>
    );
  }

  const currentEvent = replay.events[eventCursor];

  return (
    <Flex direction="column" h="calc(100vh - 60px)" overflow="hidden">
      {/* Header bar */}
      <Flex
        px={4}
        py={2}
        align="center"
        gap={3}
        borderBottom="1px solid"
        borderColor="border.subtle"
        bg="surface.card"
        flexShrink={0}
      >
        <Tooltip label="Back to aggregates" fontSize="xs">
          <IconButton
            aria-label="Back"
            icon={<ArrowBackIcon />}
            onClick={handleBack}
            variant="ghost"
            size="xs"
            color="text.secondary"
          />
        </Tooltip>
        <Text fontSize="xs" color="#00f0ff" fontFamily="mono" isTruncated>
          {selectedAggregateId}
        </Text>
        {selectedTenantId && (
          <Text fontSize="10px" color="text.muted" fontFamily="mono">
            tenant: {selectedTenantId}
          </Text>
        )}
        {replay.childAggregateIds && replay.childAggregateIds.length > 0 && (
          <Badge fontSize="10px" bg="badge.ok" color="badge.ok.text">
            +{replay.childAggregateIds.length} children
          </Badge>
        )}
        <Text fontSize="xs" color="text.muted" ml="auto">
          Event <Text as="span" fontWeight="bold" color="text.primary">{eventCursor + 1}</Text>/{replay.events.length}
        </Text>
        <Text fontSize="10px" color="text.muted">
          Arrow keys: events | e: detail panel
        </Text>
      </Flex>

      {/* Truncation warning */}
      {replay.truncated && (
        <Flex
          px={4}
          py={2}
          align="center"
          gap={3}
          bg="rgba(255, 153, 0, 0.08)"
          borderBottom="1px solid"
          borderColor="rgba(255, 153, 0, 0.2)"
          flexShrink={0}
        >
          <WarningIcon color="#ff9900" boxSize={3} />
          <Text fontSize="xs" color="#ff9900">
            Showing {replay.events.length} of {replay.totalEventCount} events.
            Large replays may be slow.
          </Text>
          <Button
            size="xs"
            variant="outline"
            borderColor="rgba(255, 153, 0, 0.4)"
            color="#ff9900"
            _hover={{ bg: "rgba(255, 153, 0, 0.1)" }}
            onClick={handleLoadAll}
            isLoading={replayLoading}
          >
            Load all {replay.totalEventCount} events
          </Button>
        </Flex>
      )}

      {/* Main content area */}
      <Flex flex="1" minH={0} overflow="hidden">
        {/* Left panel: projections + handlers list */}
        <VStack
          w="320px"
          flexShrink={0}
          align="stretch"
          spacing={1}
          p={3}
          overflowY="auto"
          borderRight="1px solid"
          borderColor="border.subtle"
          css={{
            "&::-webkit-scrollbar": { width: "6px" },
            "&::-webkit-scrollbar-track": { background: "transparent" },
            "&::-webkit-scrollbar-thumb": { background: "rgba(0, 240, 255, 0.2)", borderRadius: "3px" },
          }}
        >
          {replay.projections.length > 0 && (
            <>
              <Text fontSize="10px" color="text.muted" textTransform="uppercase" letterSpacing="0.1em" px={2} pt={1}>
                Fold Projections
              </Text>
              {replay.projections.map((p) => (
                <ProjectionItem
                  key={p.id}
                  meta={p}
                  isSelected={selectedProjectionId === p.id}
                  currentEventType={currentEvent?.type}
                  currentAggregateType={currentEvent?.aggregateType}
                  onClick={() => selectProjection(selectedProjectionId === p.id ? null : p.id)}
                />
              ))}
            </>
          )}

          {replay.handlers.length > 0 && (
            <>
              <Text fontSize="10px" color="text.muted" textTransform="uppercase" letterSpacing="0.1em" px={2} pt={3}>
                Map Projections
              </Text>
              {replay.handlers.map((h) => (
                <HandlerItem
                  key={h.id}
                  meta={h}
                  currentEventType={currentEvent?.type}
                />
              ))}
            </>
          )}

          {replay.projections.length === 0 && replay.handlers.length === 0 && (
            <Text color="text.muted" fontSize="sm" p={4}>
              No projections or event handlers discovered.
            </Text>
          )}
        </VStack>

        {/* Center panel: projection state or event data */}
        <Box flex="1" minW={0} overflowY="auto" p={4} css={{
          "&::-webkit-scrollbar": { width: "6px" },
          "&::-webkit-scrollbar-track": { background: "transparent" },
          "&::-webkit-scrollbar-thumb": { background: "rgba(0, 240, 255, 0.2)", borderRadius: "3px" },
        }}>
          {selectedProjectionId && (
            <>
              <Text fontSize="xs" color="text.muted" mb={2}>
                Projection state at event {eventCursor + 1}
                {projectionStateLoading && <Spinner size="xs" ml={2} color="#00f0ff" />}
              </Text>
              {projectionState && projectionState.length > 0 ? (
                <VStack align="stretch" spacing={3}>
                  {projectionState.map((snap) => (
                    <Box key={snap.aggregateId} borderWidth="1px" borderColor="border.subtle" borderRadius="2px" p={3} bg="surface.card">
                      <Flex gap={2} mb={2} align="center">
                        <Text fontSize="10px" color="text.muted">Aggregate:</Text>
                        <Text fontSize="xs" fontFamily="mono" color="#00f0ff">{snap.aggregateId}</Text>
                      </Flex>
                      <JsonViewer data={snap.data} />
                    </Box>
                  ))}
                </VStack>
              ) : !projectionStateLoading ? (
                <Text fontSize="sm" color="text.muted">No state computed yet.</Text>
              ) : null}
            </>
          )}

          {!selectedProjectionId && currentEvent && (
            <EventDetail event={currentEvent} />
          )}
        </Box>

        {/* Right panel: event detail (when toggled and projection is selected) */}
        {showEventDetail && selectedProjectionId && currentEvent && (
          <Box
            w="400px"
            flexShrink={0}
            borderLeft="1px solid"
            borderColor="border.subtle"
            overflowY="auto"
            p={3}
            css={{
              "&::-webkit-scrollbar": { width: "6px" },
              "&::-webkit-scrollbar-track": { background: "transparent" },
              "&::-webkit-scrollbar-thumb": { background: "rgba(0, 240, 255, 0.2)", borderRadius: "3px" },
            }}
          >
            <EventDetail event={currentEvent} />
          </Box>
        )}
      </Flex>

      {/* Bottom: event timeline */}
      <Box flexShrink={0} px={3} pb={3}>
        <EventTimeline
          events={replay.events}
          currentIndex={eventCursor}
          onSelect={setEventCursor}
        />
      </Box>
    </Flex>
  );
}

function ProjectionItem({
  meta,
  isSelected,
  currentEventType,
  currentAggregateType,
  onClick,
}: {
  meta: ProjectionMeta;
  isSelected: boolean;
  currentEventType?: string;
  currentAggregateType?: string;
  onClick: () => void;
}) {
  const matchesEvent = currentEventType ? meta.eventTypes.includes(currentEventType) : false;
  const matchesAggregate = !meta.aggregateType || meta.aggregateType === currentAggregateType;
  const isActive = matchesEvent && matchesAggregate;

  return (
    <Box
      px={3}
      py={2}
      borderRadius="2px"
      cursor="pointer"
      bg={isSelected ? "rgba(0, 240, 255, 0.08)" : "transparent"}
      borderLeft={isSelected ? "2px solid #00f0ff" : "2px solid transparent"}
      _hover={{ bg: "rgba(0, 240, 255, 0.04)" }}
      onClick={onClick}
    >
      <Flex align="center" gap={2}>
        <Box
          w="6px"
          h="6px"
          borderRadius="50%"
          bg={isActive ? "#00ff88" : "rgba(255,255,255,0.15)"}
          flexShrink={0}
        />
        <Text fontSize="xs" color={isSelected ? "#00f0ff" : "text.primary"} fontWeight={isSelected ? "600" : "400"}>
          {meta.projectionName}
        </Text>
      </Flex>
      <Text fontSize="10px" color="text.muted" ml="14px">
        {meta.pipelineName}
      </Text>
    </Box>
  );
}

function HandlerItem({
  meta,
  currentEventType,
}: {
  meta: HandlerMeta;
  currentEventType?: string;
}) {
  const matchesEvent = currentEventType ? meta.eventTypes.includes(currentEventType) : false;

  return (
    <Box px={3} py={2} borderRadius="2px" borderLeft="2px solid transparent">
      <Flex align="center" gap={2}>
        <Box
          w="6px"
          h="6px"
          borderRadius="2px"
          bg={matchesEvent ? "#ff9900" : "rgba(255,255,255,0.15)"}
          flexShrink={0}
        />
        <Text fontSize="xs" color="text.primary">
          {meta.handlerName}
        </Text>
      </Flex>
      <Text fontSize="10px" color="text.muted" ml="14px">
        {meta.pipelineName}
      </Text>
    </Box>
  );
}
