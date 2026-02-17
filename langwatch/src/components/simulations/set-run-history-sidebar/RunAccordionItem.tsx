import {
  Accordion,
  Button,
  HStack,
  Icon,
  Text,
  VStack,
} from "@chakra-ui/react";
import React from "react";
import {
  AlertCircle,
  Calendar,
  CheckCircle,
  ChevronDown,
  Clock,
  XCircle,
} from "react-feather";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import { RunHistoryItem } from "./RunHistoryItem";
import type { Run } from "./types";

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
    { passedCount: 0, failedCount: 0 },
  );

  return (
    <Accordion.Item
      value={run.scenarioRunId}
      border="none"
      borderBottom="1px solid"
      borderColor="border"
      borderLeft={isOpen ? "4px solid" : "none"}
      borderLeftColor={isOpen ? "orange.fg" : "transparent"}
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
                    ? "green.fg"
                    : failedCount > 0
                      ? "red.fg"
                      : "yellow.fg"
                }
                boxSize={3}
              />
              <Text fontWeight="semibold" fontSize="sm">
                {run.label}
              </Text>
            </HStack>
            <HStack gap={1} color="fg.muted" fontSize="2xs" align="center">
              <Icon as={Calendar} boxSize={3} />
              <Text>{new Date(run.timestamp).toLocaleString()}</Text>
              <Icon as={Clock} boxSize={3} ml={2} />
              <Text>{run.duration}</Text>
            </HStack>
            <HStack gap={1} color="fg.muted" fontSize="2xs" align="center">
              <Text fontWeight="semibold">
                {passedCount} passed, {failedCount} failed
              </Text>
            </HStack>
          </VStack>
        </Button>
        <Accordion.ItemTrigger p={7} flex="0" m={0}>
          <Accordion.ItemIndicator />
        </Accordion.ItemTrigger>
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
