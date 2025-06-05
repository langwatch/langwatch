import {
  Card,
  Text,
  Badge,
  HStack,
  VStack,
  Box,
  Collapsible,
  Spinner,
} from "@chakra-ui/react";
import { ChevronDown, Package } from "react-feather";
import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import type { ScenarioBatch } from "~/app/api/scenario-events/[[...route]]/types";
import { SimulationHistoryTable } from "./SimulationHistoryTable";
import { useFetchScenarioRunDataForBatch } from "~/hooks/simulations/useFetchScenarioRunDataForBatch";

interface BatchesTableProps {
  batches: ScenarioBatch[];
  onBatchClick: (batchRunId: string) => void;
}

// Component for success rate badge
function SuccessRateBadge({ successRate }: { successRate: number }) {
  const getSuccessConfig = (rate: number) => {
    if (rate >= 90) return { colorPalette: "green", label: `${rate}%` };
    if (rate >= 50) return { colorPalette: "yellow", label: `${rate}%` };
    return { colorPalette: "red", label: `${rate}%` };
  };

  const config = getSuccessConfig(successRate);

  return (
    <Badge colorPalette={config.colorPalette} size="sm" fontWeight="semibold">
      {config.label}
    </Badge>
  );
}

// Component for scenario count with icon
function ScenarioCount({ count }: { count: number }) {
  return (
    <HStack gap={1} align="center">
      <Box color="gray.500">
        <Package size={16} />
      </Box>
      <Text fontSize="sm" color="gray.600">
        {count} scenario{count !== 1 ? "s" : ""}
      </Text>
    </HStack>
  );
}

// Component for individual batch card with expandable functionality
function BatchCard({
  batch,
  onCardClick,
}: {
  batch: ScenarioBatch;
  onCardClick: (batchRunId: string) => void;
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  const formatDate = (date: Date) => {
    return formatDistanceToNow(date, { addSuffix: true });
  };

  const handleCardClick = () => {
    onCardClick(batch.batchRunId);
  };

  const handleExpandToggle = (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent triggering onCardClick
    setIsExpanded(!isExpanded);
  };

  return (
    <Card.Root
      borderWidth={1}
      borderColor="gray.200"
      bg="gray.50"
      transition="all 0.2s"
    >
      <Card.Body py={4} px={6}>
        <Collapsible.Root
          open={isExpanded}
          onOpenChange={(details) => setIsExpanded(details.open)}
        >
          <HStack justify="space-between" align="center">
            <HStack gap={4} align="center">
              <VStack align="start" gap={1}>
                <Text fontWeight="semibold" color="gray.900">
                  {batch.batchRunId}
                </Text>
                <VStack align="start" gap={0}>
                  <ScenarioCount count={batch.scenarioCount} />
                  <Text fontSize="sm" color="gray.600">
                    {formatDate(new Date(batch.lastRunAt ?? new Date()))}
                  </Text>
                </VStack>
              </VStack>
            </HStack>

            <HStack gap={3} align="center">
              <SuccessRateBadge successRate={batch.successRate} />
              <Collapsible.Trigger asChild>
                <Box
                  cursor="pointer"
                  color="gray.500"
                  transition="transform 0.2s"
                  transform={isExpanded ? "rotate(180deg)" : "rotate(0deg)"}
                  onClick={handleExpandToggle}
                  _hover={{ color: "gray.700" }}
                >
                  <ChevronDown size={16} />
                </Box>
              </Collapsible.Trigger>
            </HStack>
          </HStack>

          <Collapsible.Content>
            <Box mt={4} pt={4} borderTop="1px solid" borderColor="gray.200">
              <VStack align="start" gap={4}>
                <HStack gap={4}>
                  <Text fontSize="sm" color="gray.700">
                    Success Rate: {batch.successRate}%
                  </Text>
                  <Text fontSize="sm" color="gray.700">
                    Scenarios: {batch.scenarioCount}
                  </Text>
                </HStack>

                <Box
                  as="button"
                  onClick={handleCardClick}
                  bg="blue.50"
                  color="blue.600"
                  px={3}
                  py={2}
                  borderRadius="md"
                  fontSize="sm"
                  fontWeight="medium"
                  _hover={{ bg: "blue.100" }}
                  transition="all 0.2s"
                >
                  View Batch Details →
                </Box>

                {/* Use the wrapper component that fetches runs on-demand */}
                <BatchRunsHistoryWrapper
                  batchRunId={batch.batchRunId}
                  isOpen={isExpanded}
                />
              </VStack>
            </Box>
          </Collapsible.Content>
        </Collapsible.Root>
      </Card.Body>
    </Card.Root>
  );
}

// Main batches table component - no longer collapsible
export function BatchesTable({ batches, onBatchClick }: BatchesTableProps) {
  return (
    <Card.Root w="100%">
      <Card.Body>
        <Text fontSize="lg" fontWeight="bold" color="gray.900" mb={4}>
          Simulation Batches ({batches.length})
        </Text>

        <VStack gap={3} align="stretch">
          {batches.map((batch) => (
            <BatchCard
              key={batch.batchRunId}
              batch={batch}
              onCardClick={onBatchClick}
            />
          ))}
        </VStack>
      </Card.Body>
    </Card.Root>
  );
}

interface BatchRunsHistoryWrapperProps {
  batchRunId: string;
  isOpen: boolean;
}

export function BatchRunsHistoryWrapper({
  batchRunId,
  isOpen,
}: BatchRunsHistoryWrapperProps) {
  const { data, isLoading } = useFetchScenarioRunDataForBatch({
    batchRunId,
    options: {
      refreshInterval: 5000,
    },
  });

  if (!isOpen) {
    return null;
  }

  if (isLoading) {
    return (
      <VStack gap={2} py={4}>
        <Spinner size="sm" />
      </VStack>
    );
  }

  if (!data || data.length === 0) {
    return (
      <Text fontSize="sm" color="gray.600" py={4}>
        No runs found for this batch.
      </Text>
    );
  }

  return <SimulationHistoryTable history={data} />;
}
