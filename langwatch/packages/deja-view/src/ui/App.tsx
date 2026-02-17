import { Box, Text, measureElement, useApp, useInput } from "ink";
import SelectInput from "ink-select-input";
import React, { useEffect, useMemo, useRef, useState } from "react";
import type { DiscoveredEventHandler } from "../discovery/eventHandlers.types";
import type { AggregateLinkInfo } from "../discovery/links";
import type { DiscoveredProjection } from "../discovery/projections.types";
import type { Event } from "../lib/types";
import { buildEventHandlerTimelines } from "../runner/eventHandlerTimeline";
import { buildProjectionTimelines } from "../runner/projectionTimeline";
import { EventDetail } from "./EventDetail";
import { EventHandlerRow } from "./EventHandlerRow";
import { EventTimeline } from "./EventTimeline";
import { FullscreenLayout } from "./FullscreenLayout";
import { ProjectionRow } from "./ProjectionRow";
import type { ResolvedChildAggregate } from "./Root";

interface RelatedAggregate {
  id: string;
  type: string;
  relationship: "parent" | "child";
}

interface AppProps {
  events: Event[];
  projections: DiscoveredProjection[];
  eventHandlers?: DiscoveredEventHandler[];
  pipelineAggregateTypes: Record<string, string>;
  mode?: "file" | "database";
  env?: string;
  linkInfo?: AggregateLinkInfo;
  resolvedChildren?: ResolvedChildAggregate[];
  onNavigateToAggregate?: (aggregateId: string, aggregateType: string) => void;
}

/**
 * Extracts unique aggregates from events for selection.
 */
function getUniqueAggregates(
  events: Event[],
): { id: string; type: string; eventCount: number }[] {
  const aggregateMap = new Map<string, { type: string; count: number }>();

  for (const event of events) {
    const existing = aggregateMap.get(event.aggregateId);
    if (existing) {
      existing.count++;
    } else {
      aggregateMap.set(event.aggregateId, {
        type: event.aggregateType,
        count: 1,
      });
    }
  }

  return Array.from(aggregateMap.entries()).map(([id, { type, count }]) => ({
    id,
    type,
    eventCount: count,
  }));
}

/**
 * Interactive Ink application for stepping through projection states.
 *
 * @example
 * render(<App events={events} projections={projections} />);
 */
const App: React.FC<AppProps> = ({
  events,
  projections,
  eventHandlers = [],
  pipelineAggregateTypes,
  mode,
  env,
  linkInfo,
  resolvedChildren,
  onNavigateToAggregate,
}) => {
  const { exit } = useApp();
  const projectionsListRef = useRef(null);
  const [measuredHeight, setMeasuredHeight] = useState(0);
  const [selectedAggregateId, setSelectedAggregateId] = useState<string | null>(
    null,
  );
  const [eventCursor, setEventCursor] = useState(0);
  const [projectionCursor, setProjectionCursor] = useState(0);
  const [expandedProjections, setExpandedProjections] = useState<Set<string>>(
    new Set(),
  );
  const [showEventDetail, setShowEventDetail] = useState(false);
  const [projectionScrollOffset, setProjectionScrollOffset] = useState(0);
  const [showRelatedMenu, setShowRelatedMenu] = useState(false);

  const uniqueAggregates = useMemo(() => getUniqueAggregates(events), [events]);

  // Check if we're in merged timeline mode (loaded from links)
  const isMergedTimeline = resolvedChildren?.some(
    (c) => c.aggregateIds.length > 0,
  );

  // Auto-select aggregate if there's only one, or use "all" for merged timelines
  useEffect(() => {
    if (!selectedAggregateId) {
      if (isMergedTimeline) {
        // In merged mode, use special "all" value to show all events
        setSelectedAggregateId("__all__");
      } else if (uniqueAggregates.length === 1 && uniqueAggregates[0]) {
        setSelectedAggregateId(uniqueAggregates[0].id);
      }
    }
  }, [selectedAggregateId, uniqueAggregates, isMergedTimeline]);

  const filteredEvents = useMemo(() => {
    // In merged timeline mode, show all events
    let result: Event[];
    if (selectedAggregateId === "__all__") {
      result = events;
    } else if (!selectedAggregateId) {
      result = events;
    } else {
      result = events.filter((e) => e.aggregateId === selectedAggregateId);
    }
    // Sort by timestamp to match the order used in buildProjectionTimelines
    return [...result].sort((a, b) => a.timestamp - b.timestamp);
  }, [events, selectedAggregateId]);

  // Build timelines for ALL projections at once
  const projectionTimelines = useMemo(() => {
    if (filteredEvents.length === 0 || projections.length === 0) return [];
    return buildProjectionTimelines({
      events: filteredEvents as any,
      projections,
      pipelineAggregateTypes,
    });
  }, [filteredEvents, projections, pipelineAggregateTypes]);

  // Build timelines for ALL event handlers at once
  const handlerTimelines = useMemo(() => {
    if (filteredEvents.length === 0 || eventHandlers.length === 0) return [];
    return buildEventHandlerTimelines({
      events: filteredEvents,
      handlers: eventHandlers,
    });
  }, [filteredEvents, eventHandlers]);

  // Combine projections and handlers into a single list for display
  const allTimelines = useMemo(() => {
    return [
      ...projectionTimelines.map((t) => ({
        type: "projection" as const,
        timeline: t,
      })),
      ...handlerTimelines.map((t) => ({
        type: "handler" as const,
        timeline: t,
      })),
    ];
  }, [projectionTimelines, handlerTimelines]);

  // Get current event for compatibility checking (based on cursor position)
  const currentEvent = filteredEvents[eventCursor];
  const currentAggregateType = currentEvent?.aggregateType;

  // Check if a projection is compatible with the current event's aggregate type
  const isProjectionCompatible = (
    projection: DiscoveredProjection,
  ): boolean => {
    const expectedType = pipelineAggregateTypes[projection.pipelineName];
    return !expectedType || expectedType === currentAggregateType;
  };

  // Extract related aggregates from events using link info
  const relatedAggregates = useMemo((): RelatedAggregate[] => {
    if (!linkInfo || filteredEvents.length === 0) return [];

    const related: RelatedAggregate[] = [];
    const seenIds = new Set<string>();

    // Extract parent aggregate IDs
    for (const parentLink of linkInfo.parentLinks) {
      for (const event of filteredEvents) {
        const parentId = parentLink.extractParentId(event);
        if (parentId && !seenIds.has(parentId)) {
          seenIds.add(parentId);
          related.push({
            id: parentId,
            type: parentLink.toAggregateType,
            relationship: "parent",
          });
        }
      }
    }

    // Add resolved children from database query
    if (resolvedChildren) {
      for (const childGroup of resolvedChildren) {
        for (const childId of childGroup.aggregateIds) {
          if (!seenIds.has(childId)) {
            seenIds.add(childId);
            related.push({
              id: childId,
              type: childGroup.aggregateType,
              relationship: "child",
            });
          }
        }
      }
    }

    return related;
  }, [linkInfo, filteredEvents, resolvedChildren]);

  // Measure the actual height of the projections list container.
  // This bypasses terminal height detection issues — Ink's flex layout
  // correctly sizes the container, and measureElement reads the result.
  useEffect(() => {
    if (projectionsListRef.current) {
      const { height } = measureElement(projectionsListRef.current);
      if (height > 0) setMeasuredHeight(height);
    }
  });

  // Count expanded items that have actual data (need full box)
  const expandedWithData = allTimelines.filter((item) => {
    const step =
      item.timeline.steps[eventCursor] ??
      item.timeline.steps[item.timeline.steps.length - 1];
    if (item.type === "projection") {
      const projectionStep = step as {
        projectionStateByAggregate?: Array<{ data?: unknown }>;
      };
      const snapshot = projectionStep?.projectionStateByAggregate?.[0];
      return (
        expandedProjections.has(item.timeline.projection.id) &&
        snapshot?.data !== undefined
      );
    } else {
      const handlerStep = step as { processed?: boolean };
      return (
        expandedProjections.has(item.timeline.handler.id) &&
        handlerStep?.processed
      );
    }
  }).length;

  // Compute maxLinesPerExpanded from the measured container height
  // Each collapsed/v0 item takes 1 line for its title (+ 1 for expanded-without-data message)
  const collapsedAndV0Lines =
    allTimelines.length + expandedProjections.size - expandedWithData;
  const availableForExpandedBoxes = measuredHeight - collapsedAndV0Lines;
  const expandedSlots = Math.max(1, expandedWithData);
  const maxLinesPerExpanded = Math.max(
    10,
    Math.floor(availableForExpandedBoxes / expandedSlots),
  );

  const toggleProjection = (projectionId: string) => {
    setExpandedProjections((prev) => {
      const next = new Set(prev);
      if (next.has(projectionId)) {
        next.delete(projectionId);
      } else {
        next.add(projectionId);
      }
      return next;
    });
    setProjectionScrollOffset(0); // Reset scroll when toggling
  };

  useInput((input, key) => {
    // Quit
    if (input === "q") {
      exit();
      return;
    }

    // Only handle navigation after aggregate is selected
    if (!selectedAggregateId) return;

    // Event navigation (left/right)
    if (key.leftArrow || input === "h") {
      setEventCursor((prev) => Math.max(0, prev - 1));
      setProjectionScrollOffset(0); // Reset scroll on event change
    } else if (key.rightArrow || input === "l") {
      setEventCursor((prev) => Math.min(filteredEvents.length - 1, prev + 1));
      setProjectionScrollOffset(0); // Reset scroll on event change
    }

    // Projection navigation (up/down)
    if (key.upArrow || input === "k") {
      setProjectionCursor((prev) => Math.max(0, prev - 1));
      setProjectionScrollOffset(0); // Reset scroll when changing projection
    } else if (key.downArrow || input === "j") {
      setProjectionCursor((prev) =>
        Math.min(allTimelines.length - 1, prev + 1),
      );
      setProjectionScrollOffset(0); // Reset scroll when changing item
    }

    // Scroll within expanded projection ([ and ])
    if (input === "[") {
      setProjectionScrollOffset((prev) => Math.max(0, prev - 3));
    } else if (input === "]") {
      setProjectionScrollOffset((prev) => prev + 3);
    }

    // Toggle expand (Enter/Space)
    if (key.return || input === " ") {
      const currentItem = allTimelines[projectionCursor];
      if (currentItem) {
        const id =
          currentItem.type === "projection"
            ? currentItem.timeline.projection.id
            : currentItem.timeline.handler.id;
        toggleProjection(id);
      }
    }

    // Toggle event detail panel
    if (input === "e") {
      setShowEventDetail((prev) => !prev);
    }

    // Toggle related aggregates menu (not in merged timeline mode)
    if (input === "r" && !isMergedTimeline && relatedAggregates.length > 0) {
      setShowRelatedMenu((prev) => !prev);
    }
  });

  if (events.length === 0) {
    return (
      <FullscreenLayout>
        <Text>No events in the provided log.</Text>
      </FullscreenLayout>
    );
  }

  // Step 1: Select aggregate to track
  if (!selectedAggregateId) {
    return (
      <FullscreenLayout>
        <Box flexDirection="column">
          <Text bold>Select an aggregate to track:</Text>
          <Text dimColor>
            Found {uniqueAggregates.length} unique aggregate(s) in{" "}
            {events.length} events
          </Text>
          <Box marginTop={1}>
            <SelectInput
              items={uniqueAggregates.map((agg) => ({
                label: `[${agg.type}] ${agg.id} (${agg.eventCount} events)`,
                value: agg.id,
              }))}
              onSelect={(item) => setSelectedAggregateId(item.value)}
            />
          </Box>
          <Box marginTop={1}>
            <Text dimColor>Press q to quit</Text>
          </Box>
        </Box>
      </FullscreenLayout>
    );
  }

  if (projections.length === 0) {
    return (
      <FullscreenLayout>
        <Text color="red">
          No projections discovered under event-sourcing pipelines directory.
        </Text>
      </FullscreenLayout>
    );
  }

  if (filteredEvents.length === 0) {
    return (
      <FullscreenLayout>
        <Text>No events for the selected aggregates.</Text>
      </FullscreenLayout>
    );
  }

  // Count parent and child links
  const parentCount = relatedAggregates.filter(
    (r) => r.relationship === "parent",
  ).length;
  const childCount = relatedAggregates.filter(
    (r) => r.relationship === "child",
  ).length;

  return (
    <FullscreenLayout>
      {/* Header */}
      <Box
        borderStyle="single"
        borderColor="cyan"
        paddingX={1}
        justifyContent="space-between"
        flexShrink={0}
      >
        <Box flexShrink={1} overflow="hidden">
          <Text wrap="truncate">
            {isMergedTimeline ? (
              <>
                <Text color="cyan">{uniqueAggregates.length} aggregates</Text>
                <Text dimColor> (merged)</Text>
              </>
            ) : (
              <>
                Agg: <Text color="cyan">{selectedAggregateId}</Text>
              </>
            )}
          </Text>
          {mode === "database" && env && <Text dimColor> ({env})</Text>}
          {!isMergedTimeline && relatedAggregates.length > 0 && (
            <Text dimColor>
              {" "}
              | {parentCount > 0 && <Text color="yellow">{parentCount}↑</Text>}
              {parentCount > 0 && childCount > 0 && " "}
              {childCount > 0 && <Text color="green">{childCount}↓</Text>} (r)
            </Text>
          )}
        </Box>
        <Box flexShrink={0}>
          <Text>
            <Text bold>{eventCursor + 1}</Text>/{filteredEvents.length}
          </Text>
        </Box>
      </Box>

      {/* Related aggregates menu (hidden in merged timeline mode) */}
      {showRelatedMenu && !isMergedTimeline && relatedAggregates.length > 0 && (
        <Box
          borderStyle="single"
          borderColor="yellow"
          paddingX={1}
          flexDirection="column"
          flexShrink={0}
        >
          <Text bold color="yellow">
            Related Aggregates (press r to close)
          </Text>
          <SelectInput
            items={relatedAggregates.map((r) => ({
              label:
                r.relationship === "parent"
                  ? `↑ ${r.type}: ${r.id}`
                  : `↓ ${r.type}: ${r.id}`,
              value: r,
            }))}
            onSelect={(item) => {
              if (onNavigateToAggregate) {
                onNavigateToAggregate(item.value.id, item.value.type);
              }
              setShowRelatedMenu(false);
            }}
          />
        </Box>
      )}

      {/* Main content fills remaining space to keep footer pinned */}
      <Box
        flexDirection="column"
        flexGrow={1}
        flexShrink={1}
        minHeight={0}
        overflow="hidden"
      >
        {/* Projections list */}
        <Box
          ref={projectionsListRef}
          flexDirection="column"
          flexGrow={1}
          flexShrink={1}
          minHeight={0}
          overflow="hidden"
        >
          {allTimelines.map((item, index) => {
            const step =
              item.timeline.steps[eventCursor] ??
              item.timeline.steps[item.timeline.steps.length - 1];
            const isFocused = index === projectionCursor;
            const id =
              item.type === "projection"
                ? item.timeline.projection.id
                : item.timeline.handler.id;
            const isExpanded = expandedProjections.has(id);

            if (item.type === "projection") {
              const compatible = isProjectionCompatible(
                item.timeline.projection,
              );
              const expectedType =
                pipelineAggregateTypes[item.timeline.projection.pipelineName];
              const projectionStep = step as
                | { stale?: boolean; projectionStateByAggregate?: unknown[] }
                | undefined;
              const isStale = projectionStep?.stale ?? false;
              return (
                <ProjectionRow
                  key={item.timeline.projection.id}
                  timeline={item.timeline}
                  currentStep={step as any}
                  isExpanded={isExpanded}
                  isFocused={isFocused}
                  maxLines={maxLinesPerExpanded}
                  scrollOffset={
                    isFocused && isExpanded ? projectionScrollOffset : 0
                  }
                  isCompatible={compatible}
                  expectedAggregateType={expectedType}
                  stale={isStale}
                  currentAggregateId={currentEvent?.aggregateId}
                />
              );
            } else {
              return (
                <EventHandlerRow
                  key={item.timeline.handler.id}
                  timeline={item.timeline}
                  currentStep={step as any}
                  isExpanded={isExpanded}
                  isFocused={isFocused}
                  maxLines={maxLinesPerExpanded}
                  scrollOffset={
                    isFocused && isExpanded ? projectionScrollOffset : 0
                  }
                />
              );
            }
          })}
        </Box>

        {/* Timeline at bottom */}
        <EventTimeline events={filteredEvents} currentIndex={eventCursor} />

        {/* Event detail panel */}
        {showEventDetail && currentEvent && (
          <EventDetail event={currentEvent} maxJsonLines={8} />
        )}
      </Box>

      {/* Help footer */}
      <Box paddingX={1} flexShrink={0}>
        <Text dimColor>
          ↑↓/jk: projection | ←→/hl: events | Enter: expand | []: scroll | e:
          event
          {!isMergedTimeline && relatedAggregates.length > 0
            ? " | r: related"
            : ""}{" "}
          | q: quit
        </Text>
      </Box>
    </FullscreenLayout>
  );
};

export default App;
