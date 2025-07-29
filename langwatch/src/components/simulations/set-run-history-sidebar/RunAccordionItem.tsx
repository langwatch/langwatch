import React from "react";
import {
  VStack,
  HStack,
  Text,
  Icon,
  Accordion,
  Button,
} from "@chakra-ui/react";
import {
  CheckCircle,
  XCircle,
  AlertCircle,
  Calendar,
  Clock,
  ChevronDown,
} from "react-feather";
import { ScenarioRunStatus } from "~/app/api/scenario-events/[[...route]]/enums";
import type { Run } from "./types";
import { RunHistoryItem } from "./RunHistoryItem";

// Run accordion section
export const RunAccordionItem = ({
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
      w="full"
      p={0}
      h="full"
    >
      <HStack w="full" alignItems="space-between" gap={0} h="full">
        <Button
          variant="ghost"
          onClick={() => onRunClick(run.batchRunId)}
          flex={1}
          h="full"
          m={0}
        >
          <VStack
            align="center"
            w="full"
            gap={0}
            p={2}
            flex="1"
            h="full"
            alignItems="flex-start"
          >
            <HStack flex="1" textAlign="left" gap={2}>
              <Icon
                as={
                  passedCount > 0 && failedCount === 0
                    ? CheckCircle
                    : failedCount > 0
                    ? XCircle
                    : AlertCircle
                }
                color={
                  passedCount > 0 && failedCount === 0
                    ? "green.400"
                    : failedCount > 0
                    ? "red.400"
                    : "yellow.400"
                }
                boxSize={3}
              />
              <Text fontWeight="semibold" fontSize="sm">
                {run.label}
              </Text>
            </HStack>
            <HStack gap={1} color="gray.500" fontSize="2xs" align="center">
              <Icon as={Calendar} boxSize={3} />
              <Text>{new Date(run.timestamp).toLocaleString()}</Text>
              <Icon as={Clock} boxSize={3} ml={2} />
              <Text>{run.duration}</Text>
            </HStack>
            <HStack gap={1} color="gray.500" fontSize="2xs" align="center">
              <Text fontWeight="semibold">
                {passedCount} passed, {failedCount} failed
              </Text>
            </HStack>
          </VStack>
        </Button>
        <Accordion.ItemTrigger p={7} flex="0" m={0}>
          <Icon
            as={ChevronDown}
            boxSize={4}
            transform={isOpen ? "rotate(180deg)" : "rotate(0deg)"}
          />
        </Accordion.ItemTrigger>
        <Accordion.ItemIndicator />
      </HStack>
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
