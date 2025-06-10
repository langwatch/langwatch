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

// Types for props
type RunItem = {
  status: string;
  title: string;
  description: string;
};

type Run = {
  id: string;
  label: string;
  date: string;
  duration: string;
  items: RunItem[];
};

type SetRunHistorySidebarProps = {
  scenarioSetId: string;
};

// Single test case row
const RunHistoryItem = ({ item }: { item: RunItem }) => (
  <HStack align="center" gap={3} py={2} pl={3}>
    <Icon
      as={item.status === "passed" ? Check : XCircle}
      color={item.status === "passed" ? "green.400" : "red.400"}
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

// Run accordion section
const RunAccordionItem = ({ run, isOpen }: { run: Run; isOpen: boolean }) => {
  const { passedCount, failedCount } = run.items.reduce(
    (acc, item) => {
      if (item.status === "passed") {
        acc.passedCount++;
      } else if (item.status === "failed") {
        acc.failedCount++;
      } else {
        // do nothing
      }
      return acc;
    },
    { passedCount: 0, failedCount: 0 }
  );

  return (
    <Accordion.Item
      value={run.id}
      border="none"
      borderBottom="1px solid"
      borderColor="gray.200"
      p={4}
    >
      <h2>
        <Accordion.ItemTrigger>
          <HStack w="full">
            <VStack align="flex-start" w="full" gap={0}>
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
          <VStack align="stretch" gap={0}>
            {run.items.map((item, idx) => (
              <RunHistoryItem key={idx} item={item} />
            ))}
          </VStack>
        </Accordion.ItemBody>
      </Accordion.ItemContent>
    </Accordion.Item>
  );
};

const useSetRunHistorySidebarController = (
  props: SetRunHistorySidebarProps
) => {
  const { scenarioSetId } = props;
  const { project } = useOrganizationTeamProject();

  const { data: runData } = api.scenarios.getScenarioSetRunData.useQuery(
    {
      projectId: project?.id ?? "",
      scenarioSetId,
    },
    {
      enabled: !!project?.id && !!scenarioSetId,
    }
  );

  const batchRuns: Record<string, Run> = {};

  runData?.forEach((run) => {
    if (!batchRuns[run.batchRunId]) {
      batchRuns[run.batchRunId] = {
        id: run.scenarioRunId,
        label: `Run #${Object.keys(batchRuns).length + 1}`,
        date: new Date(run.timestamp ?? 0).toLocaleString(),
        duration: "10s",
        items: [
          {
            title: run.name ?? "",
            description: run.description ?? "",
            status:
              run.status === ScenarioRunStatus.SUCCESS ? "passed" : "failed",
          },
        ],
      };
      return;
    } else {
      batchRuns[run.batchRunId]?.items.push({
        title: run.name ?? "",
        description: run.description ?? "",
        status: run.status === ScenarioRunStatus.SUCCESS ? "passed" : "failed",
      });
    }
  });

  const runs = Object.values(batchRuns);

  return {
    runs,
  };
};

// Main sidebar component
const SetRunHistorySidebarComponent = (
  props: ReturnType<typeof useSetRunHistorySidebarController>
) => {
  const [openIndex, setOpenIndex] = useState<string[]>(["0"]);
  const { runs } = props;

  return (
    <Box
      bg={useColorModeValue("white", "gray.900")}
      borderRight="1px"
      borderColor={useColorModeValue("gray.200", "gray.700")}
      h="100vh"
      w="500px"
      overflowY="auto"
    >
      <Text
        fontSize="lg"
        fontWeight="bold"
        mb={4}
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
            key={run.id}
            run={run}
            isOpen={openIndex.includes(run.id)}
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
