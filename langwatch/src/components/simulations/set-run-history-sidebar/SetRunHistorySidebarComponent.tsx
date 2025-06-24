import React, { useState } from "react";
import { Box, Text, Accordion, VStack, Skeleton, Flex, EmptyState, Spinner } from "@chakra-ui/react";
import { useColorModeValue } from "../../ui/color-mode";
import { useSetRunHistorySidebarController } from "./useSetRunHistorySidebarController";
import { RunAccordionItem } from "./RunAccordionItem";

// Main sidebar component
export const SetRunHistorySidebarComponent = (
  props: ReturnType<typeof useSetRunHistorySidebarController>
) => {
  const [openIndex, setOpenIndex] = useState<string[]>(["0"]);
  const { runs, onRunClick, isLoading, scenarioSetId } = props;

  return (
    <Box
      bg={useColorModeValue("white", "gray.900")}
      borderRight="1px"
      borderColor={useColorModeValue("gray.200", "gray.700")}
      w="full"
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
      {isLoading && runs.length === 0 && (
        <VStack gap={3} align="stretch" p={4}>
          {Array.from({ length: 3 }).map((_, idx) => (
            <Box
              key={idx}
              p={3}
              borderRadius="md"
              border="1px solid"
              borderColor="gray.200"
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
                You haven't run any simulations yet for the set
                <code>{scenarioSetId ?? "unknown"}</code>
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
          {runs.map((run, idx) => (
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
  );
};
