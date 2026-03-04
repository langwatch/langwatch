import {
  Badge,
  Box,
  Collapsible,
  HStack,
  Text,
  VStack,
} from "@chakra-ui/react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import type { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import type { ScenarioResults } from "~/server/scenarios/schemas";
import { Drawer } from "../ui/drawer";
import { ScenarioRunStatusIcon } from "./ScenarioRunStatusIcon";
import { SCENARIO_RUN_STATUS_CONFIG } from "./scenario-run-status-config";

export function DrawerHeader({
  name,
  status,
  durationInMs,
}: {
  name?: string | null;
  status?: ScenarioRunStatus;
  durationInMs?: number;
}) {
  const statusConfig = status
    ? SCENARIO_RUN_STATUS_CONFIG[status]
    : undefined;

  return (
    <Drawer.Header borderBottom="1px" borderColor="border" pb={3}>
      <VStack align="start" gap={2} w="100%">
        <HStack gap={2}>
          <ScenarioRunStatusIcon status={status} />
          <Text fontSize="lg" fontWeight="semibold">
            {name ?? "Scenario Run"}
          </Text>
        </HStack>
        <HStack gap={2}>
          {statusConfig && (
            <Badge colorPalette={statusConfig.colorPalette} size="sm">
              {statusConfig.label}
            </Badge>
          )}
          {durationInMs != null && (
            <Text fontSize="sm" color="fg.muted">
              {formatDuration(durationInMs)}
            </Text>
          )}
        </HStack>
      </VStack>
    </Drawer.Header>
  );
}

export function formatDuration(ms: number): string {
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds.toFixed(0)}s`;
}

export function CriteriaSummary({
  results,
}: {
  results?: ScenarioResults | null;
}) {
  if (!results) return null;

  const metCount = results.metCriteria?.length ?? 0;
  const unmetCount = results.unmetCriteria?.length ?? 0;
  const totalCount = metCount + unmetCount;

  return (
    <Box>
      <Text fontWeight="semibold" mb={2}>
        Criteria: {metCount}/{totalCount} passed
      </Text>
      <VStack align="stretch" gap={1}>
        {results.metCriteria?.map((criterion) => (
          <CriterionRow
            key={`met-${criterion}`}
            name={criterion}
            passed={true}
          />
        ))}
        {results.unmetCriteria?.map((criterion) => (
          <CriterionRow
            key={`unmet-${criterion}`}
            name={criterion}
            passed={false}
            reasoning={results.reasoning}
          />
        ))}
      </VStack>
    </Box>
  );
}

export function CriterionRow({
  name,
  passed,
  reasoning,
}: {
  name: string;
  passed: boolean;
  reasoning?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasReasoning = !passed && reasoning;

  return (
    <Box>
      <HStack
        gap={2}
        py={1}
        px={2}
        borderRadius="md"
        _hover={hasReasoning ? { bg: "bg.muted" } : undefined}
        cursor={hasReasoning ? "pointer" : "default"}
        onClick={hasReasoning ? () => setExpanded(!expanded) : undefined}
        role={hasReasoning ? "button" : undefined}
        aria-expanded={hasReasoning ? expanded : undefined}
      >
        <Text color={passed ? "green.500" : "red.500"} fontSize="sm" flexShrink={0}>
          {passed ? "PASS" : "FAIL"}
        </Text>
        <Text fontSize="sm" flex={1}>
          {name}
        </Text>
        {hasReasoning && (
          expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />
        )}
      </HStack>
      {hasReasoning && (
        <Collapsible.Root open={expanded}>
          <Collapsible.Content>
            <Box px={2} py={2} ml={8} bg="bg.muted" borderRadius="md" mt={1}>
              <Text fontSize="sm" color="fg.muted" whiteSpace="pre-wrap">
                {reasoning}
              </Text>
            </Box>
          </Collapsible.Content>
        </Collapsible.Root>
      )}
    </Box>
  );
}
