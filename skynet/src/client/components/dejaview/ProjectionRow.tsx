import { Box, Flex, Text, Badge, Collapse } from "@chakra-ui/react";
import type { ProjectionTimeline, ProjectionStep } from "../../../shared/dejaview.types.ts";
import { JsonViewer } from "./JsonViewer.tsx";

interface ProjectionRowProps {
  timeline: ProjectionTimeline;
  currentStep: ProjectionStep | undefined;
  isExpanded: boolean;
  isFocused: boolean;
  pipelineAggregateTypes: Record<string, string>;
  currentAggregateType?: string;
  currentAggregateId?: string;
  onToggle: () => void;
  onClick: () => void;
}

export function ProjectionRow({
  timeline,
  currentStep,
  isExpanded,
  isFocused,
  pipelineAggregateTypes,
  currentAggregateType,
  currentAggregateId,
  onToggle,
  onClick,
}: ProjectionRowProps) {
  const { projection } = timeline;
  const expectedType = pipelineAggregateTypes[projection.pipelineName];
  const isCompatible = !expectedType || expectedType === currentAggregateType;
  const isStale = currentStep?.stale ?? false;

  // Find snapshot matching the current event's aggregate, or fall back to first
  const snapshot = currentAggregateId
    ? (currentStep?.projectionStateByAggregate.find((s) => s.aggregateId === currentAggregateId) ??
       currentStep?.projectionStateByAggregate[0])
    : currentStep?.projectionStateByAggregate[0];

  const hasData = snapshot?.data !== undefined;

  return (
    <Box
      borderWidth="1px"
      borderColor={isFocused ? "#00f0ff" : "border.subtle"}
      borderRadius="2px"
      bg={isFocused ? "rgba(0, 240, 255, 0.04)" : "surface.card"}
      overflow="hidden"
      transition="all 0.15s"
      opacity={!isCompatible || isStale ? 0.5 : 1}
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
          {projection.pipelineName}/{projection.projectionName}
        </Text>

        {hasData && (
          <Badge fontSize="10px" bg="badge.neutral" color="badge.neutral.text" ml="auto">
            v{snapshot.version}
          </Badge>
        )}
        {isStale && hasData && (
          <Badge fontSize="10px" bg="badge.stale" color="badge.stale.text">
            unchanged
          </Badge>
        )}
        {!isCompatible && expectedType && (
          <Badge fontSize="10px" bg="rgba(255,170,0,0.12)" color="#ffaa00">
            expects {expectedType}
          </Badge>
        )}
      </Flex>

      {/* Expanded content */}
      <Collapse in={isExpanded} animateOpacity>
        <Box px={3} pb={3}>
          {!hasData && (
            <Text fontSize="xs" color="text.muted" fontStyle="italic">
              No data yet — awaiting first matching event
            </Text>
          )}
          {hasData && snapshot && (
            <>
              <Flex gap={3} mb={2} fontSize="10px" color="text.muted">
                <Text>Aggregate: {snapshot.aggregateId}</Text>
                <Text>Tenant: {snapshot.tenantId}</Text>
              </Flex>
              {isStale && (
                <Text fontSize="xs" color="text.muted" mb={1}>
                  ↳ State unchanged by this event
                </Text>
              )}
              <JsonViewer data={snapshot.data} dimmed={isStale} />
            </>
          )}
        </Box>
      </Collapse>
    </Box>
  );
}
