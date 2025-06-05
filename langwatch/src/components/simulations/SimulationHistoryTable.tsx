import {
  Card,
  Text,
  Badge,
  HStack,
  VStack,
  Box,
  Collapsible,
} from "@chakra-ui/react";
import {
  ChevronDown,
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
} from "react-feather";
import { useState } from "react";
import type { ScenarioRunFinishedEvent } from "~/app/api/scenario-events/[[...route]]/types";
import { formatDistanceToNow } from "date-fns";
import { useSimulationRouter } from "~/hooks/simulations/useSimulationRouter";

interface SimulationHistoryTableProps {
  history: ScenarioRunFinishedEvent[];
}

// Component for status icon based on status
function StatusIcon({ status }: { status: string }) {
  const getStatusConfig = (status: string) => {
    switch (status) {
      case "SUCCESS":
        return { icon: CheckCircle, color: "green.500" };
      case "FAILED":
        return { icon: XCircle, color: "red.500" };
      case "IN_PROGRESS":
        return { icon: Clock, color: "yellow.500" };
      default:
        return { icon: AlertTriangle, color: "gray.500" };
    }
  };

  const config = getStatusConfig(status);
  const IconComponent = config.icon;

  return (
    <Box color={config.color}>
      <IconComponent size={20} />
    </Box>
  );
}

// Component for verdict badge
function VerdictBadge({ verdict }: { verdict?: string }) {
  if (!verdict) return null;

  const getVerdictConfig = (verdict: string) => {
    switch (verdict.toLowerCase()) {
      case "success":
        return { colorPalette: "green", label: "PASS" };
      case "failure":
        return { colorPalette: "red", label: "FAIL" };
      case "partial":
        return { colorPalette: "yellow", label: "PARTIAL" };
      default:
        return { colorPalette: "gray", label: verdict.toUpperCase() };
    }
  };

  const config = getVerdictConfig(verdict);

  return (
    <Badge colorPalette={config.colorPalette} size="sm" fontWeight="semibold">
      {config.label}
    </Badge>
  );
}

// Component for criteria summary display
function CriteriaSummary({
  metCriteria,
  unmetCriteria,
}: {
  metCriteria: string[];
  unmetCriteria: string[];
}) {
  const metCount = metCriteria.length;
  const totalCount = metCount + unmetCriteria.length;

  if (totalCount === 0) {
    return null;
  }

  // Determine color based on success rate
  const successRate = metCount / totalCount;
  const getColor = () => {
    if (successRate === 1) return "green.600";
    if (successRate >= 0.5) return "yellow.600";
    return "red.600";
  };

  return (
    <Text fontSize="sm" color={getColor()} fontWeight="bold">
      {metCount}/{totalCount}
    </Text>
  );
}

// Component for individual history run card
function HistoryRunCard({
  event,
  onCardClick,
}: {
  event: ScenarioRunFinishedEvent;
  onCardClick: (runId: string) => void;
}) {
  return (
    <Card.Root
      cursor="pointer"
      onClick={() => onCardClick(event.scenarioRunId)}
      _hover={{ bg: "gray.25", borderColor: "gray.300" }}
      transition="all 0.2s"
      borderWidth={1}
      borderColor="gray.200"
      bg="gray.50"
    >
      <Card.Body py={4} px={6}>
        <HStack justify="space-between" align="center">
          <HStack gap={4} align="center">
            <StatusIcon status={event.status} />
            <VStack align="start" gap={1}>
              <Text fontWeight="semibold" color="gray.900">
                Run {event.scenarioRunId}
              </Text>
              <VStack align="start" gap={0}>
                <Text fontSize="sm" color="gray.600">
                  {formatDistanceToNow(event.timestamp || Date.now(), {
                    addSuffix: true,
                  })}
                </Text>
              </VStack>
            </VStack>
          </HStack>

          <HStack gap={3} align="center">
            <VerdictBadge verdict={event.results?.verdict} />
            {event.results && (
              <CriteriaSummary
                metCriteria={event.results.metCriteria}
                unmetCriteria={event.results.unmetCriteria}
              />
            )}
          </HStack>
        </HStack>
      </Card.Body>
    </Card.Root>
  );
}

// Main history component using proper Collapsible
export function SimulationHistoryTable({
  history,
}: SimulationHistoryTableProps) {
  const [isOpen, setIsOpen] = useState(false);
  const { goToSimulationRun } = useSimulationRouter();

  const handleCardClick = (runId: string) => {
    goToSimulationRun(runId);
  };

  return (
    <Card.Root w="100%">
      <Card.Body>
        <Collapsible.Root
          open={isOpen}
          onOpenChange={(details) => setIsOpen(details.open)}
        >
          <Collapsible.Trigger asChild>
            <Box cursor="pointer" transition="all 0.2s">
              <HStack justify="space-between" align="center">
                <Text fontSize="lg" fontWeight="bold" color="gray.900">
                  Run History ({history.length})
                </Text>
                <Box
                  color="gray.500"
                  transition="transform 0.2s"
                  transform={isOpen ? "rotate(180deg)" : "rotate(0deg)"}
                >
                  <ChevronDown size={20} />
                </Box>
              </HStack>
            </Box>
          </Collapsible.Trigger>

          <Collapsible.Content>
            <Box mt={4}>
              <VStack gap={3} align="stretch">
                {history.map((event) => (
                  <HistoryRunCard
                    key={event.scenarioRunId}
                    event={event}
                    onCardClick={handleCardClick}
                  />
                ))}
              </VStack>
            </Box>
          </Collapsible.Content>
        </Collapsible.Root>
      </Card.Body>
    </Card.Root>
  );
}
