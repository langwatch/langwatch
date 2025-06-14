import React, { useState } from "react";
import { Box, Text, Accordion } from "@chakra-ui/react";
import { useColorModeValue } from "../../ui/color-mode";
import { useSetRunHistorySidebarController } from "./useSetRunHistorySidebarController";
import { RunAccordionItem } from "./RunAccordionItem";

// Main sidebar component
export const SetRunHistorySidebarComponent = (
  props: ReturnType<typeof useSetRunHistorySidebarController>
) => {
  const [openIndex, setOpenIndex] = useState<string[]>(["0"]);
  const { runs, onRunClick } = props;

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
