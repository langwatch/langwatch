import { Box, Flex, Text, Badge, Collapse } from "@chakra-ui/react";
import type { EventHandlerTimeline, EventHandlerStep } from "../../../shared/dejaview.types.ts";
import { JsonViewer } from "./JsonViewer.tsx";

interface EventHandlerRowProps {
  timeline: EventHandlerTimeline;
  currentStep: EventHandlerStep | undefined;
  isExpanded: boolean;
  isFocused: boolean;
  onToggle: () => void;
  onClick: () => void;
}

export function EventHandlerRow({
  timeline,
  currentStep,
  isExpanded,
  isFocused,
  onToggle,
  onClick,
}: EventHandlerRowProps) {
  const { handler } = timeline;
  const processed = currentStep?.processed ?? false;
  const hasDisplayData = currentStep?.displayData !== undefined;

  return (
    <Box
      borderWidth="1px"
      borderColor={isFocused ? "#00f0ff" : "border.subtle"}
      borderRadius="2px"
      bg={isFocused ? "rgba(0, 240, 255, 0.04)" : "surface.card"}
      overflow="hidden"
      transition="all 0.15s"
    >
      {/* Header */}
      <Flex
        px={3}
        py={2}
        align="center"
        cursor="pointer"
        onClick={() => { onClick(); onToggle(); }}
        _hover={{ bg: "surface.hover" }}
        gap={2}
      >
        <Text fontSize="xs" color="text.muted" w="14px" flexShrink={0}>
          {isExpanded ? "▼" : "▶"}
        </Text>
        <Text fontSize="sm" color={isFocused ? "#00f0ff" : "text.primary"} fontWeight={isFocused ? "600" : "400"}>
          {handler.pipelineName}/{handler.handlerName}
        </Text>

        <Badge
          fontSize="10px"
          ml="auto"
          bg={processed ? "badge.ok" : "badge.neutral"}
          color={processed ? "badge.ok.text" : "badge.neutral.text"}
        >
          {processed ? "✓" : "○"}
        </Badge>

        {handler.eventTypes && handler.eventTypes.length > 0 && (
          <Text fontSize="10px" color="text.muted" maxW="200px" isTruncated>
            ({handler.eventTypes.join(", ")})
          </Text>
        )}
      </Flex>

      {/* Expanded content */}
      <Collapse in={isExpanded} animateOpacity>
        <Box px={3} pb={3}>
          {!processed && (
            <Text fontSize="xs" color="text.muted" fontStyle="italic">
              No matching events yet
            </Text>
          )}
          {processed && hasDisplayData && currentStep?.displayData !== undefined && (
            <>
              <Flex gap={3} mb={2} fontSize="10px" color="text.muted">
                <Text>Event: {currentStep.eventType}</Text>
                <Text>Processed: Yes</Text>
              </Flex>
              <JsonViewer data={currentStep.displayData} />
            </>
          )}
          {processed && !hasDisplayData && (
            <Text fontSize="xs" color="text.muted" fontStyle="italic">
              Handler processed this event but has no display data
            </Text>
          )}
        </Box>
      </Collapse>
    </Box>
  );
}
