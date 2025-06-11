import React, { useState } from "react";
import { Box, VStack, HStack, Text, Icon, Accordion } from "@chakra-ui/react";
import {
  CheckCircle,
  XCircle,
  AlertCircle,
  Calendar,
  Clock,
  ChevronDown,
  Check,
  X,
} from "react-feather";
import { useColorModeValue } from "../ui/color-mode";
import { withController } from "~/utils/withControllerHOC";
import { api } from "~/utils/api";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { ScenarioRunStatus } from "~/app/api/scenario-events/[[...route]]/enums";
import { useSimulationRouter } from "~/hooks/simulations/useSimulationRouter";

// Types for props
type RunItem = {
  status: ScenarioRunStatus;
  title: string;
  description: string;
  batchRunId: string;
  scenarioRunId: string;
};

type Run = {
  batchRunId: string;
  scenarioRunId: string;
  label: string;
  date: string;
  duration: string;
  items: RunItem[];
};

// Single test case row
const RunHistoryItem = ({ item }: { item: RunItem }) => {
  const { goToSimulationRun, scenarioSetId } = useSimulationRouter();
  return (
    <HStack
      align="center"
      gap={3}
      py={2}
      pl={3}
      cursor="pointer"
      onClick={(e) => {
        e.stopPropagation();
        if (scenarioSetId) {
          goToSimulationRun({
            scenarioSetId,
            batchRunId: item.batchRunId,
            scenarioRunId: item.scenarioRunId,
          });
        }
      }}
    >
      <Icon
        as={item.status === ScenarioRunStatus.SUCCESS ? Check : XCircle}
        color={
          item.status === ScenarioRunStatus.SUCCESS ? "green.400" : "red.400"
        }
        boxSize={4}
        mt={1}
      />
      <Box>
        <Text fontWeight="semibold" fontSize="xs">
          {item.title}
        </Text>
        <Text fontSize="xs" color={useColorModeValue("gray.600", "gray.400")}>
          {item.description}
        </Text>
      </Box>
    </HStack>
  );
};

// Run accordion section
const RunAccordionItem = ({
  run,
  isOpen,
  onRunClick,
}: {
  run: Run;
  isOpen: boolean;
  onRunClick: (batchRunId: string) => void;
}) => {
  const { passedCount, failedCount } = run.items.reduce(
    (acc, item) => {
      if (item.status === ScenarioRunStatus.SUCCESS) {
        acc.passedCount++;
      } else if (
        item.status === ScenarioRunStatus.FAILED ||
        item.status === ScenarioRunStatus.ERROR
      ) {
        acc.failedCount++;
      } else {
        // do nothing for other statuses like IN_PROGRESS, PENDING, CANCELLED
      }
      return acc;
    },
    { passedCount: 0, failedCount: 0 }
  );

  return (
    <Accordion.Item
      value={run.scenarioRunId}
      border="none"
      borderBottom="1px solid"
      borderColor="gray.200"
      borderLeft={isOpen ? "4px solid" : "none"}
      borderLeftColor={isOpen ? "orange.400" : "transparent"}
      p={0}
    >
      <h2>
        <Accordion.ItemTrigger p={2}>
          <HStack w="full">
            <VStack
              align="flex-start"
              w="full"
              gap={0}
              onClick={(e) => {
                e.stopPropagation();
                onRunClick(run.batchRunId);
              }}
            >
              <HStack flex="1" textAlign="left" gap={2}>
                <Icon as={AlertCircle} color="yellow.400" boxSize={2} />
                <Text fontWeight="semibold" fontSize="sm">
                  {run.label}
                </Text>
              </HStack>
              <HStack
                gap={1}
                color="gray.500"
                fontSize="2xs"
                ml={2}
                align="center"
              >
                <Icon as={Calendar} boxSize={3} />
                <Text>{run.date}</Text>
                <Icon as={Clock} boxSize={3} ml={2} />
                <Text>{run.duration}</Text>
              </HStack>
              <HStack
                gap={1}
                color="gray.500"
                fontSize="2xs"
                ml={2}
                align="center"
              >
                <Text fontWeight="semibold">
                  {passedCount} passed, {failedCount} failed
                </Text>
              </HStack>
            </VStack>
            <Icon
              as={ChevronDown}
              boxSize={4}
              transform={isOpen ? "rotate(180deg)" : "rotate(0deg)"}
            />
          </HStack>
          <Accordion.ItemIndicator />
        </Accordion.ItemTrigger>
      </h2>
      <Accordion.ItemContent>
        <Accordion.ItemBody>
          <VStack align="stretch" gap={0} pb={3}>
            {run.items.map((item, idx) => (
              <RunHistoryItem key={idx} item={item} />
            ))}
          </VStack>
        </Accordion.ItemBody>
      </Accordion.ItemContent>
    </Accordion.Item>
  );
};

const useSetRunHistorySidebarController = () => {
  const { goToSimulationBatchRuns, scenarioSetId } = useSimulationRouter();
  const { project } = useOrganizationTeamProject();

  const { data: runData } = api.scenarios.getScenarioSetRunData.useQuery(
    {
      projectId: project?.id ?? "",
      scenarioSetId: scenarioSetId ?? "",
    },
    {
      enabled: !!project?.id && !!scenarioSetId,
    }
  );

  const batchRuns: Record<string, Omit<Run, "label">> = {};

  runData?.forEach((run) => {
    if (!batchRuns[run.batchRunId]) {
      batchRuns[run.batchRunId] = {
        scenarioRunId: run.scenarioRunId,
        batchRunId: run.batchRunId,
        date: new Date(run.timestamp ?? 0).toLocaleString(),
        duration: `${Math.round(run.durationInMs) / 1000}s`,
        items: [
          {
            title: run.name ?? "",
            description: run.description ?? "",
            status: run.status,
            batchRunId: run.batchRunId,
            scenarioRunId: run.scenarioRunId,
          },
        ],
      };
      return;
    } else {
      batchRuns[run.batchRunId]?.items.push({
        title: run.name ?? "",
        description: run.description ?? "",
        status: run.status,
        batchRunId: run.batchRunId,
        scenarioRunId: run.scenarioRunId,
      });
    }
  });

  const runs = Object.values(batchRuns)
    .sort((a, b) => {
      return new Date(a.date).getTime() - new Date(b.date).getTime();
    })
    .map((run, idx) => {
      return {
        ...run,
        label: `Run #${idx + 1}`,
      };
    })
    .reverse();

  return {
    runs,
    onRunClick: (batchRunId: string) => {
      if (scenarioSetId) {
        goToSimulationBatchRuns(scenarioSetId, batchRunId);
      } else {
        console.warn("scenarioSetId is not defined");
      }
    },
    scenarioSetId,
  };
};

// Main sidebar component
const SetRunHistorySidebarComponent = (
  props: ReturnType<typeof useSetRunHistorySidebarController>
) => {
  const [openIndex, setOpenIndex] = useState<string[]>(["0"]);
  const { runs, onRunClick } = props;

  return (
    <Box
      bg={useColorModeValue("white", "gray.900")}
      borderRight="1px"
      borderColor={useColorModeValue("gray.200", "gray.700")}
      w="500px"
      overflowY="auto"
      h="100%"
    >
      <Text
        fontSize="lg"
        fontWeight="bold"
        p={4}
        borderBottom="1px solid"
        borderColor="gray.200"
      >
        History
      </Text>
      <Accordion.Root
        collapsible
        onValueChange={(value) => setOpenIndex(value.value)}
      >
        {runs.map((run, idx) => (
          <RunAccordionItem
            key={run.scenarioRunId}
            run={run}
            isOpen={openIndex.includes(run.scenarioRunId)}
            onRunClick={onRunClick}
          />
        ))}
      </Accordion.Root>
    </Box>
  );
};

export const SetRunHistorySidebar = withController(
  SetRunHistorySidebarComponent,
  useSetRunHistorySidebarController
);
