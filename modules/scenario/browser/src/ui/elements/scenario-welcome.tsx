import { Card } from "@langwatch/design-system/card";
import { Dialog } from "@langwatch/design-system/dialog";
import { Box, Button, Heading, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { ArrowRight, FlaskConical, RefreshCw } from "lucide-react";

const capabilities = [
  {
    icon: FlaskConical,
    title: "Automated testing",
    description:
      "Define test scenarios that run automatically against your AI agent to verify it handles real-world situations correctly.",
  },
  {
    icon: RefreshCw,
    title: "Regression detection",
    description:
      "Catch regressions early by re-running scenarios after every change, ensuring your agent never breaks existing behavior.",
  },
] satisfies readonly {
  icon: typeof FlaskConical;
  title: string;
  description: string;
}[];

const INTRO =
  "Scenarios let you test your agent behavior with repeatable, automated checks. Define situations, set expectations, and verify your agent responds correctly every time.";

function CapabilityCards({ variant }: { variant: "panel" | "nested" }) {
  return (
    <VStack gap={4} w="full">
      {capabilities.map(({ icon: Icon, title, description }) => (
        <Card key={title} variant={variant} padding="lg">
          <HStack gap={4} align="start">
            <Box
              p={2}
              borderRadius="md"
              bg="blue.subtle"
              color="blue.fg"
              _dark={{ bg: "blue.subtle", color: "blue.fg" }}
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
        </Card>
      ))}
    </VStack>
  );
}

export function ScenarioWelcomeScreen({ onProceed }: { onProceed: () => void }) {
  return (
    <VStack py={16} px={8} maxW="640px" mx="auto">
      <VStack gap={8} align="center">
        <VStack gap={3} textAlign="center">
          <Heading as="h2" size="lg">
            Welcome to Scenarios
          </Heading>
          <Text fontSize="md" color="fg.muted">
            {INTRO}
          </Text>
        </VStack>
        <CapabilityCards variant="panel" />
        <Button colorPalette="orange" variant="solid" size="lg" onClick={onProceed}>
          Create Your First Scenario <ArrowRight size={16} />
        </Button>
      </VStack>
    </VStack>
  );
}

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
    <Dialog
      open={open}
      onClose={() => onOpenChange(false)}
      title="Welcome to Scenarios"
      description={INTRO}
      size="lg"
      placement="center"
      primaryAction={{
        label: "Create Your First Scenario",
        icon: <ArrowRight size={14} />,
        onClick: onProceed,
      }}
    >
      <CapabilityCards variant="nested" />
    </Dialog>
  );
}
