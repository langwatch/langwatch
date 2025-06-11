import React from "react";
import { Box, Code } from "@chakra-ui/react";
import { useColorModeValue } from "~/components/ui/color-mode";

// Console-like component for displaying test results
export function SimulationConsole({
  results,
  scenarioName,
  status,
  durationInMs,
}: {
  results?: any;
  scenarioName?: string;
  status?: string;
  durationInMs?: number;
}) {
  const consoleBg = useColorModeValue("gray.900", "gray.800");
  const consoleText = useColorModeValue("green.300", "green.300");

  const passed = status === "SUCCESS" ? 1 : 0;
  const failed = status === "SUCCESS" ? 0 : 1;
  const successRate = status === "SUCCESS" ? "100.0%" : "0.0%";
  const duration = durationInMs ? (durationInMs / 1000).toFixed(2) : "0.00";
  const agentTime = durationInMs
    ? ((durationInMs * 0.7) / 1000).toFixed(2)
    : "0.00"; // Mock agent time as 70% of total

  const consoleOutput = `=== Scenario Test Report ===
Total Scenarios: 1
Passed: ${passed}
Failed: ${failed}  
Success Rate: ${successRate}
1. ${scenarioName || "User is looking for a order cancellation request"} – ${
    status === "SUCCESS" ? "PASSED" : "FAILED"
  } in ${duration}s (agent: ${agentTime}s)
   Reasoning: ${
     results?.reasoning ||
     "The recipe provided is vegetarian, includes a list of ingredients, and has step-by-step cooking instructions."
   }
   Success Criteria: ${results?.metCriteria?.length || 1}/${
     (results?.metCriteria?.length || 1) + (results?.unmetCriteria?.length || 0)
   }`;

  return (
    <Box
      bg={consoleBg}
      color={consoleText}
      p={4}
      borderRadius="md"
      fontFamily="mono"
      fontSize="sm"
      minHeight="200px"
      overflow="auto"
    >
      <Code
        colorScheme="green"
        bg="transparent"
        color="inherit"
        whiteSpace="pre-wrap"
      >
        {consoleOutput}
      </Code>
    </Box>
  );
}
