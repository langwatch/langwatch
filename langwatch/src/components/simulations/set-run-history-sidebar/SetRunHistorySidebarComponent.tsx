import {
  Accordion,
  Box,
  Button,
  EmptyState,
  Flex,
  HStack,
  Icon,
  Skeleton,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import React, { useState } from "react";
import { ChevronLeft, ChevronRight, Clock } from "react-feather";
import {
  isOnPlatformSet,
  ON_PLATFORM_DISPLAY_NAME,
} from "~/server/scenarios/internal-set-id";
import { RunAccordionItem } from "./RunAccordionItem";
import type { useSetRunHistorySidebarController } from "./useSetRunHistorySidebarController";

// Main sidebar component
export const SetRunHistorySidebarComponent = (
  props: ReturnType<typeof useSetRunHistorySidebarController>,
) => {
  const [openIndex, setOpenIndex] = useState<string[]>(["0"]);
  const { runs, onRunClick, isLoading, scenarioSetId, pagination } = props;
  const displayName =
    scenarioSetId && isOnPlatformSet(scenarioSetId)
      ? ON_PLATFORM_DISPLAY_NAME
      : scenarioSetId ?? "unknown";

  return (
    <Box
      bg="bg.panel"
      borderRight="1px"
      borderColor="border"
      w="full"
      overflowY="auto"
      h="100%"
      display="flex"
      flexDirection="column"
    >
      <HStack
        px={4}
        minH="44px"
        borderBottom="1px solid"
        borderColor="border"
        gap={2}
        align="center"
      >
        <Icon as={Clock} boxSize={4} color="fg.muted" />
        <Text fontSize="md" fontWeight="semibold">
          Run History
        </Text>
      </HStack>

      <Box flex="1" overflowY="auto">
        {isLoading && runs.length === 0 && (
          <VStack gap={3} align="stretch" p={4}>
            {Array.from({ length: 3 }).map((_, idx) => (
              <Box
                key={idx}
                p={3}
                borderRadius="md"
                border="1px solid"
                borderColor="border"
                w="100%"
              >
                <VStack align="start" gap={2} w="100%">
                  <Flex align="center" gap={2} w="100%">
                    <Skeleton height="18px" width="24px" borderRadius="full" />
                    <Skeleton height="18px" width="70px" />
                  </Flex>
                  <Skeleton height="14px" width="50%" />
                  <Skeleton height="12px" width="30%" />
                </VStack>
              </Box>
            ))}
          </VStack>
        )}

        {!isLoading && runs.length === 0 && (
          <EmptyState.Root size={"md"}>
            <EmptyState.Content>
              <EmptyState.Indicator>
                <Spinner />
              </EmptyState.Indicator>
              <VStack textAlign="center">
                <EmptyState.Title>This set is all alone</EmptyState.Title>
                <EmptyState.Description>
                  You haven&apos;t run any simulations yet for the set
                  <code>{displayName}</code>
                </EmptyState.Description>
              </VStack>
            </EmptyState.Content>
          </EmptyState.Root>
        )}

        {runs.length > 0 && (
          <Accordion.Root
            collapsible
            onValueChange={(value) => setOpenIndex(value.value)}
          >
            {runs.map((run) => (
              <RunAccordionItem
                key={run.scenarioRunId}
                run={run}
                isOpen={openIndex.includes(run.scenarioRunId)}
                onRunClick={onRunClick}
              />
            ))}
          </Accordion.Root>
        )}
      </Box>

      {/* Pagination bar */}
      <Box
        px={4}
        py={2}
        borderTop="1px solid"
        borderColor="border"
        bg="bg.panel"
      >
        <HStack justify="space-between" align="center">
          <Button
            size="xs"
            variant="ghost"
            onClick={pagination.onPrevPage}
            disabled={!pagination.hasPrevPage}
            px={2}
          >
            <Icon as={ChevronLeft} boxSize={4} />
          </Button>

          <Text fontSize="xs" color="fg.muted">
            {pagination.totalCount} runs · Page {pagination.page} of{" "}
            {Math.max(1, pagination.totalPages)}
          </Text>

          <Button
            size="xs"
            variant="ghost"
            onClick={pagination.onNextPage}
            disabled={!pagination.hasNextPage}
            px={2}
          >
            <Icon as={ChevronRight} boxSize={4} />
          </Button>
        </HStack>
      </Box>
    </Box>
  );
};
