import { Box, Button, Heading, HStack, Text, VStack } from "@chakra-ui/react";
import { FlaskConical, RefreshCw, ArrowRight } from "lucide-react";

type ScenarioWelcomeScreenProps = {
  onProceed: () => void;
};

const CAPABILITIES = [
  {
    icon: FlaskConical,
    title: "Automated Testing",
    description:
      "Define test scenarios that run automatically against your AI agent to verify it handles real-world situations correctly.",
  },
  {
    icon: RefreshCw,
    title: "Regression Detection",
    description:
      "Catch regressions early by re-running scenarios after every change, ensuring your agent never breaks existing behavior.",
  },
] as const;

/**
 * Welcome onboarding screen shown when a user creates their first scenario.
 * Explains what scenarios do and highlights key capabilities before proceeding
 * to the creation flow.
 */
export function ScenarioWelcomeScreen({
  onProceed,
}: ScenarioWelcomeScreenProps) {
  return (
    <VStack gap={8} align="center" py={16} px={8} maxW="640px" mx="auto">
      <VStack gap={3} textAlign="center">
        <Heading as="h2" size="xl">
          Welcome to Scenarios
        </Heading>
        <Text fontSize="md" color="fg.muted">
          Scenarios let you test your agent behavior with repeatable,
          automated checks. Define situations, set expectations, and verify
          your agent responds correctly every time.
        </Text>
      </VStack>

      <VStack gap={4} w="full">
        {CAPABILITIES.map(({ icon: Icon, title, description }) => (
          <HStack
            key={title}
            gap={4}
            p={5}
            w="full"
            borderWidth="1px"
            borderColor="border"
            borderRadius="lg"
            align="start"
          >
            <Box
              p={2}
              borderRadius="md"
              bg="blue.50"
              color="blue.600"
              _dark={{ bg: "blue.900", color: "blue.200" }}
              flexShrink={0}
            >
              <Icon size={20} />
            </Box>
            <VStack gap={1} align="start">
              <Text fontWeight="semibold">{title}</Text>
              <Text fontSize="sm" color="fg.muted">
                {description}
              </Text>
            </VStack>
          </HStack>
        ))}
      </VStack>

      <Button colorPalette="blue" size="lg" onClick={onProceed}>
        Create Your First Scenario <ArrowRight size={16} />
      </Button>
    </VStack>
  );
}
