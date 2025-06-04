import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { type ScenarioResults } from "~/app/api/scenario-events/[[...route]]/schemas";

export function SimulationResults({ results }: { results: ScenarioResults }) {
  return (
    <Box mt={4} p={4} width="100%" alignSelf="flex-start" height="100%">
      <Text fontWeight="bold" mb={2} fontSize="lg">
        Results
      </Text>
      <VStack alignItems="flex-start" gap={4}>
        <HStack>
          <Text fontWeight="semibold" color="gray.700">
            Verdict:
          </Text>
          <Text color="gray.800">{results.verdict}</Text>
        </HStack>
        {results.reasoning && (
          <Box>
            <Text fontWeight="semibold" color="gray.700" fontSize="md">
              Reasoning:
            </Text>
            <Text color="gray.800">{results.reasoning}</Text>
          </Box>
        )}
        <Box>
          <Text fontWeight="semibold" color="gray.700" fontSize="md">
            Met Criteria:
          </Text>
          {results.metCriteria.length > 0 ? (
            <VStack alignItems="flex-start" pl={4}>
              {results.metCriteria.map((criteria: string, idx: number) => (
                <Text key={idx} color="green.700">
                  • {criteria}
                </Text>
              ))}
            </VStack>
          ) : (
            <Text color="gray.400" pl={4}>
              None
            </Text>
          )}
        </Box>
        <Box>
          <Text fontWeight="semibold" color="gray.700" fontSize="md">
            Unmet Criteria:
          </Text>
          {results.unmetCriteria.length > 0 ? (
            <VStack alignItems="flex-start" pl={4}>
              {results.unmetCriteria.map((criteria: string, idx: number) => (
                <Text key={idx} color="red.700">
                  • {criteria}
                </Text>
              ))}
            </VStack>
          ) : (
            <Text color="gray.400" pl={4}>
              None
            </Text>
          )}
        </Box>
      </VStack>
    </Box>
  );
}
