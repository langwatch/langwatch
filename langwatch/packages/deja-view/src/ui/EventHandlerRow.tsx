import { Box, Text } from "ink";
import React from "react";
import type { EventHandlerTimelineTypes } from "../runner/eventHandlerTimeline.types";
import { JsonViewer } from "./JsonViewer";

interface EventHandlerRowProps {
  timeline: EventHandlerTimelineTypes["Timeline"];
  currentStep: EventHandlerTimelineTypes["Step"] | undefined;
  isExpanded: boolean;
  isFocused: boolean;
  maxLines?: number;
  scrollOffset?: number;
}

/**
 * Collapsible row showing event handler name and activity, with expandable display data JSON.
 *
 * @example
 * <EventHandlerRow timeline={timeline} currentStep={step} isExpanded={false} isFocused={true} />
 */
export const EventHandlerRow: React.FC<EventHandlerRowProps> = ({
  timeline,
  currentStep,
  isExpanded,
  isFocused,
  maxLines = 20,
  scrollOffset = 0,
}) => {
  const { handler } = timeline;
  const processed = currentStep?.processed ?? false;
  const hasDisplayData = currentStep?.displayData !== undefined;

  const expandIndicator = isExpanded ? "▼" : "▶";
  const processedIndicator = processed ? "✓" : "○";

  // Calculate available lines for JsonViewer content
  // maxLines is the total budget for this entire EventHandlerRow from parent
  // We need to subtract: title line (1) + metadata line inside box
  // Note: scroll indicators are handled internally by JsonViewer
  const titleLines = 1; // The expandable handler name line
  const metadataLines = 1; // "Event: X | Processed: Y" line

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
        {/* Focus indicator */}
        <Text color="cyan" bold={isFocused}>
          {isFocused ? " " : " "}
        </Text>
        <Text
          color={isFocused ? "cyan" : undefined}
          bold={isFocused}
          wrap="truncate"
        >
          {expandIndicator} {handler.pipelineName}/{handler.handlerName}
        </Text>
        <Text color={processed ? "green" : "gray"}> {processedIndicator}</Text>
        {handler.eventTypes && handler.eventTypes.length > 0 && (
          <Text color="gray" dimColor>
            {" "}
            ({handler.eventTypes.join(", ")})
          </Text>
        )}
        {isFocused && isExpanded && scrollOffset > 0 && (
          <Text dimColor> (scroll: {scrollOffset})</Text>
        )}
      </Box>

      {isExpanded && !processed && (
        <Box marginLeft={4}>
          <Text dimColor>(no matching events yet)</Text>
        </Box>
      )}

      {isExpanded &&
        processed &&
        hasDisplayData &&
        currentStep?.displayData !== undefined && (
          <Box
            marginLeft={2}
            borderStyle="round"
            borderColor={isFocused ? "cyan" : "gray"}
            paddingX={1}
            flexDirection="column"
            flexShrink={0}
          >
            <Text dimColor>
              Event: {currentStep.eventType} | Processed:{" "}
              {processed ? "Yes" : "No"}
            </Text>
            <JsonViewer
              data={currentStep.displayData}
              maxLines={jsonMaxLines}
              scrollOffset={scrollOffset}
              dimmed={false}
            />
          </Box>
        )}

      {isExpanded && processed && !hasDisplayData && (
        <Box marginLeft={4}>
          <Text dimColor>
            (handler processed this event but has no display data)
          </Text>
        </Box>
      )}
    </Box>
  );
};
