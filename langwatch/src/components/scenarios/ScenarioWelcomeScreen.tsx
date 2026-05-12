import { Box, Button, Heading, HStack, Text, VStack } from "@chakra-ui/react";
import { FlaskConical, RefreshCw, ArrowRight } from "lucide-react";
import { Dialog } from "../ui/dialog";

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
 * Shared welcome content used by both the inline page view and the modal.
 */
function ScenarioWelcomeContent({ onProceed }: { onProceed: () => void }) {
  return (
    <VStack gap={8} align="center">
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

/**
 * Inline welcome screen rendered directly in the page layout
 * when a user has zero scenarios and hasn't seen the welcome before.
 */
export function ScenarioWelcomeScreen({
  onProceed,
}: {
  onProceed: () => void;
}) {
  return (
    <VStack py={16} px={8} maxW="640px" mx="auto">
      <ScenarioWelcomeContent onProceed={onProceed} />
    </VStack>
  );
}

/**
 * Modal version of the welcome screen, shown when "New Scenario" is clicked
 * from any entry point and the user hasn't completed onboarding yet.
 */
export function ScenarioWelcomeModal({
  open,
  onOpenChange,
  onProceed,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onProceed: () => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(e) => onOpenChange(e.open)} placement="center" size="lg">
      <Dialog.Content maxWidth="640px">
        <Dialog.CloseTrigger />
        <Dialog.Body py={8} px={8}>
          <ScenarioWelcomeContent onProceed={onProceed} />
        </Dialog.Body>
      </Dialog.Content>
    </Dialog.Root>
  );
}
