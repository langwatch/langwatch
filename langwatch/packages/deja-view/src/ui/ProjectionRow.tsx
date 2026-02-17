import { Box, Text } from "ink";
import React from "react";
import type { ProjectionTimelineTypes } from "../runner/projectionTimeline.types";
import { JsonViewer } from "./JsonViewer";

interface ProjectionRowProps {
  timeline: ProjectionTimelineTypes["Timeline"];
  currentStep: ProjectionTimelineTypes["Step"] | undefined;
  isExpanded: boolean;
  isFocused: boolean;
  maxLines?: number;
  scrollOffset?: number;
  isCompatible?: boolean;
  expectedAggregateType?: string;
  /** Whether this is carried-forward state (event didn't affect this projection) */
  stale?: boolean;
  /** Current event's aggregate ID - used to show matching snapshot in merged mode */
  currentAggregateId?: string;
}

/**
 * Collapsible row showing projection name and version, with expandable state JSON.
 *
 * @example
 * <ProjectionRow timeline={timeline} currentStep={step} isExpanded={false} isFocused={true} />
 */
export const ProjectionRow: React.FC<ProjectionRowProps> = ({
  timeline,
  currentStep,
  isExpanded,
  isFocused,
  maxLines = 20,
  scrollOffset = 0,
  isCompatible = true,
  expectedAggregateType,
  stale = false,
  currentAggregateId,
}) => {
  const { projection } = timeline;
  // Find snapshot matching the current event's aggregate, or fall back to first
  const snapshot = currentAggregateId
    ? (currentStep?.projectionStateByAggregate.find(
        (s) => s.aggregateId === currentAggregateId,
      ) ?? currentStep?.projectionStateByAggregate[0])
    : currentStep?.projectionStateByAggregate[0];
  const hasData = snapshot?.data !== void 0;

  const expandIndicator = isExpanded ? "▼" : "▶";

  // Dim incompatible or stale projections, but keep focus visible
  const isDimmed = !isCompatible || stale;

  // Calculate available lines for JsonViewer content
  // maxLines is the total budget for this entire ProjectionRow from parent
  // We need to subtract: title line (1) + metadata lines inside box
  // Note: scroll indicators are handled internally by JsonViewer
  const titleLines = 1; // The expandable projection name line
  const metadataLines =
    1 + // Aggregate line
    (!isCompatible ? 1 : 0) +
    (stale ? 1 : 0);

  // Calculate how many lines the content box can have (including JsonViewer + its indicators)
  const contentBoxMaxLines =
    maxLines !== undefined ? maxLines - titleLines : undefined;

  // Calculate how many lines JsonViewer can display (it will add indicators if needed)
  // Subtract 2 for the border lines (top + bottom) since height includes the border
  const jsonMaxLines =
    contentBoxMaxLines !== undefined
      ? Math.max(5, contentBoxMaxLines - metadataLines - 2)
      : undefined;

  return (
    <Box
      flexDirection="column"
      flexShrink={0}
    >
      <Box flexShrink={0}>
        {/* Focus indicator - always visible even when dimmed */}
        <Text color="cyan" bold={isFocused}>
          {isFocused ? " " : " "}
        </Text>
        <Text
          color={isDimmed ? "gray" : isFocused ? "cyan" : undefined}
          bold={!isDimmed && isFocused}
          dimColor={isDimmed}
          wrap="truncate"
        >
          {expandIndicator} {projection.pipelineName}/
          {projection.projectionName}
        </Text>
        <Text color="gray">{hasData && ` v${snapshot.version}`}</Text>
        {hasData && stale && (
          <Text color="gray" dimColor>
            {" "}
            (unchanged)
          </Text>
        )}
        {!isCompatible && expectedAggregateType && (
          <Text color="yellow" dimColor wrap="truncate">
            {" "}
            (expects {expectedAggregateType})
          </Text>
        )}
        {isFocused && isExpanded && scrollOffset > 0 && (
          <Text dimColor> (scroll: {scrollOffset})</Text>
        )}
      </Box>

      {isExpanded && !hasData && (
        <Box marginLeft={4}>
          <Text dimColor>(no data yet - awaiting first matching event)</Text>
        </Box>
      )}

      {isExpanded && hasData && snapshot && (
        <Box
          marginLeft={2}
          borderStyle="round"
          borderColor={
            !isCompatible
              ? "yellow"
              : stale
                ? "gray"
                : isFocused
                  ? "cyan"
                  : "gray"
          }
          paddingX={1}
          flexDirection="column"
          flexShrink={0}
        >
          {!isCompatible && (
            <Text color="yellow">
              ⚠ This projection expects "{expectedAggregateType}" aggregate
              events
            </Text>
          )}
          {stale && <Text dimColor>↳ State unchanged by this event</Text>}
          <Text dimColor>
            Aggregate: {snapshot.aggregateId} | Tenant: {snapshot.tenantId}
          </Text>
          <JsonViewer
            data={snapshot.data}
            maxLines={jsonMaxLines}
            scrollOffset={scrollOffset}
            dimmed={stale}
          />
        </Box>
      )}
    </Box>
  );
};
