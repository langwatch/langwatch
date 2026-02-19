import {
  Accordion,
  Box,
  HStack,
  Icon,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import React from "react";
import {
  AlertCircle,
  CheckCircle,
  XCircle,
} from "react-feather";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import { formatTimeAgo } from "~/utils/formatTimeAgo";
import { RunHistoryItem } from "./RunHistoryItem";
import type { Run } from "./types";

const CompletionStatus = ({
  run,
}: {
  run: Run;
}) => {
  const isRunning = run.isRunning ?? false;

  if (run.allCompletedAt) {
    return (
      <Text fontSize="2xs" color="fg.muted">
        Completed {formatTimeAgo(run.allCompletedAt)}
      </Text>
    );
  }
  if (run.firstCompletedAt) {
    return (
      <Text fontSize="2xs" color="orange.fg">
        First done {formatTimeAgo(run.firstCompletedAt)}, still running…
      </Text>
    );
  }
  if (isRunning) {
    return (
      <Text fontSize="2xs" color="orange.fg">
        Running…
      </Text>
    );
  }
  return (
    <Text fontSize="2xs" color="fg.muted">
      {formatTimeAgo(run.timestamp)}
    </Text>
  );
};

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
  const { passedCount, failedCount, stalledCount } = run.items.reduce(
    (acc, item) => {
      if (item.status === ScenarioRunStatus.SUCCESS) {
        acc.passedCount++;
      } else if (
        item.status === ScenarioRunStatus.FAILED ||
        item.status === ScenarioRunStatus.ERROR
      ) {
        acc.failedCount++;
      } else if (item.status === ScenarioRunStatus.STALLED) {
        acc.stalledCount++;
      }
      return acc;
    },
    { passedCount: 0, failedCount: 0, stalledCount: 0 },
  );

  const isRunning = run.isRunning ?? false;

  return (
    <Accordion.Item
      value={run.scenarioRunId}
      border="none"
      borderBottom="1px solid"
      borderColor="border"
      boxShadow={isOpen ? "inset 3px 0 0 0 var(--chakra-colors-orange-500)" : "none"}
      w="full"
      p={0}
      h="full"
      {...(isRunning
        ? {
            animation: "pulse-glow 2s ease-in-out infinite",
            css: {
              "@keyframes pulse-glow": {
                "0%, 100%": { boxShadow: "inset 0 0 0 0 transparent" },
                "50%": { boxShadow: "inset 0 0 8px 0 var(--chakra-colors-orange-200)" },
              },
              ".dark &": {
                "@keyframes pulse-glow": {
                  "0%, 100%": { boxShadow: "inset 0 0 0 0 transparent" },
                  "50%": { boxShadow: "inset 0 0 8px 0 var(--chakra-colors-orange-800)" },
                },
              },
            },
          }
        : {})}
    >
      <HStack w="full" gap={0} alignItems="stretch">
        <Box
          as="button"
          onClick={() => onRunClick(run.batchRunId)}
          flex={1}
          cursor="pointer"
          borderRadius={0}
          _hover={{ bg: "bg.muted" }}
          transition="background 0.15s"
          textAlign="left"
        >
          <VStack
            align="start"
            w="full"
            gap={1}
            px={3}
            py={2}
          >
            <HStack gap={2}>
              {isRunning ? (
                <Spinner size="xs" color="orange.fg" />
              ) : (
                <Icon
                  as={
                    failedCount > 0
                      ? XCircle
                      : stalledCount > 0
                        ? AlertCircle
                        : passedCount > 0
                          ? CheckCircle
                          : AlertCircle
                  }
                  color={
                    failedCount > 0
                      ? "red.fg"
                      : stalledCount > 0
                        ? "yellow.fg"
                        : passedCount > 0
                          ? "green.fg"
                          : "yellow.fg"
                  }
                  boxSize={3}
                />
              )}
              <Text fontWeight="semibold" fontSize="sm">
                {run.label}
              </Text>
            </HStack>
            <CompletionStatus run={run} />
            <HStack gap={2} fontSize="2xs" align="center">
              <HStack gap={1}>
                <Box boxSize={2} borderRadius="full" bg="green.solid" />
                <Text color="fg.muted">{passedCount}</Text>
              </HStack>
              <HStack gap={1}>
                <Box boxSize={2} borderRadius="full" bg="red.solid" />
                <Text color="fg.muted">{failedCount}</Text>
              </HStack>
              {stalledCount > 0 && (
                <HStack gap={1}>
                  <Box boxSize={2} borderRadius="full" bg="yellow.solid" />
                  <Text color="fg.muted">{stalledCount}</Text>
                </HStack>
              )}
            </HStack>
          </VStack>
        </Box>
        <Accordion.ItemTrigger
          flex="0"
          m={0}
          px={3}
          py={0}
          alignSelf="stretch"
          display="flex"
          alignItems="center"
          borderRadius={0}
          _hover={{ bg: "bg.muted" }}
          transition="background 0.15s"
          cursor="pointer"
        >
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
