import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { type ScenarioResults } from "~/app/api/scenario-events/[[...route]]/schemas";

// Component for displaying the verdict with proper styling
function VerdictSection({ verdict }: { verdict: string }) {
  return (
    <HStack align="center" w="100%">
      <Text fontWeight="semibold" color="gray.700" fontSize="md">
        Verdict:
      </Text>
      <Text
        fontWeight="bold"
        fontSize="md"
        color={verdict === "success" ? "green.600" : "red.600"}
        textTransform="uppercase"
      >
        {verdict}
      </Text>
    </HStack>
  );
}

// Component for displaying reasoning text
function ReasoningSection({ reasoning }: { reasoning?: string }) {
  if (!reasoning) return null;

  return (
    <Box w="100%">
      <Text fontWeight="semibold" color="gray.700" fontSize="md" mb={2}>
        Reasoning:
      </Text>
      <Text color="gray.800" fontSize="sm" lineHeight="tall">
        {reasoning}
      </Text>
    </Box>
  );
}

// Component for displaying a list of criteria with colored bullet points
function CriteriaSection({
  title,
  criteria,
  color,
}: {
  title: string;
  criteria: string[];
  color: "green" | "red";
}) {
  const bulletColor = color === "green" ? "green.500" : "red.500";
  const textColor = color === "green" ? "green.700" : "red.700";

  return (
    <Box w="100%">
      <Text fontWeight="semibold" color="gray.700" fontSize="md" mb={3}>
        {title}:
      </Text>
      {criteria.length > 0 ? (
        <VStack alignItems="flex-start" gap={2} pl={2}>
          {criteria.map((criterion: string, idx: number) => (
            <HStack key={idx} align="flex-start" gap={3}>
              <Box
                w={2}
                h={2}
                bg={bulletColor}
                borderRadius="full"
                mt={2}
                flexShrink={0}
              />
              <Text color={textColor} fontSize="sm" lineHeight="tall">
                {criterion}
              </Text>
            </HStack>
          ))}
        </VStack>
      ) : (
        <Text color="gray.400" fontSize="sm" pl={2}>
          None
        </Text>
      )}
    </Box>
  );
}

// Main results component that orchestrates the smaller components
export function SimulationResults({ results }: { results: ScenarioResults }) {
  return (
    <Box p={6} width="100%" height="100%">
      <Text fontSize="xl" fontWeight="bold" mb={6} color="gray.900">
        Results
      </Text>
      <VStack alignItems="flex-start" gap={6} height="100%">
        <VerdictSection verdict={results.verdict} />

        <ReasoningSection reasoning={results.reasoning} />

        <CriteriaSection
          title="Met Criteria"
          criteria={results.metCriteria}
          color="green"
        />

        <CriteriaSection
          title="Unmet Criteria"
          criteria={results.unmetCriteria}
          color="red"
        />
      </VStack>
    </Box>
  );
}
