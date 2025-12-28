import {
  Box,
  Button,
  Heading,
  HStack,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Bot, FileText } from "lucide-react";
import { LuArrowLeft } from "react-icons/lu";

import { Drawer } from "~/components/ui/drawer";
import { useDrawer, getComplexProps } from "~/hooks/useDrawer";
import { type RunnerType } from "~/evaluations-v3/types";

// Re-export for backward compatibility
export type { RunnerType };

export type RunnerTypeSelectorDrawerProps = {
  open?: boolean;
  onClose?: () => void;
  onSelect?: (type: RunnerType) => void;
};

const runnerTypes: Array<{
  type: RunnerType;
  icon: typeof FileText;
  title: string;
  description: string;
}> = [
  {
    type: "prompt",
    icon: FileText,
    title: "Prompt",
    description: "Select versioned prompt or create a new one",
  },
  {
    type: "agent",
    icon: Bot,
    title: "Agent",
    description: "Integrate with your existing agent or create a workflow",
  },
];

/**
 * Drawer for selecting the type of runner to add to an evaluation.
 * Shows cards for Prompt vs Agent with icons and descriptions.
 */
export function RunnerTypeSelectorDrawer(props: RunnerTypeSelectorDrawerProps) {
  const { closeDrawer, openDrawer, canGoBack, goBack } = useDrawer();
  const complexProps = getComplexProps();

  const onClose = props.onClose ?? closeDrawer;
  const onSelect = props.onSelect ?? (complexProps.onSelect as RunnerTypeSelectorDrawerProps["onSelect"]);
  const isOpen = props.open !== false && props.open !== undefined;

  const handleSelectType = (type: RunnerType) => {
    // Navigate to appropriate drawer based on type
    if (onSelect) {
      // Parent handles navigation (backward compat)
      onSelect(type);
    } else {
      // Use drawer navigation
      if (type === "prompt") {
        openDrawer("promptList", {}, { replace: true });
      } else if (type === "agent") {
        openDrawer("agentList", {}, { replace: true });
      }
    }
  };

  return (
    <Drawer.Root
      open={isOpen}
      onOpenChange={({ open }) => !open && onClose()}
      size="md"
    >
      <Drawer.Content>
        <Drawer.CloseTrigger />
        <Drawer.Header>
          <HStack gap={2}>
            {canGoBack && (
              <Button
                variant="ghost"
                size="sm"
                onClick={goBack}
                padding={1}
                minWidth="auto"
                data-testid="back-button"
              >
                <LuArrowLeft size={20} />
              </Button>
            )}
            <Heading>Add to Evaluation</Heading>
          </HStack>
        </Drawer.Header>
        <Drawer.Body display="flex" flexDirection="column" overflow="hidden" padding={0}>
          <VStack gap={4} align="stretch" flex={1} overflow="hidden">
            <Text color="gray.600" fontSize="sm" paddingX={6} paddingTop={4}>
              Choose what you want to evaluate - a prompt from your library or a custom agent.
            </Text>

            {/* Runner type cards */}
            <VStack
              gap={3}
              align="stretch"
              paddingX={6}
              paddingBottom={4}
            >
              {runnerTypes.map((runnerType) => (
                <RunnerTypeCard
                  key={runnerType.type}
                  {...runnerType}
                  onClick={() => handleSelectType(runnerType.type)}
                />
              ))}
            </VStack>
          </VStack>
        </Drawer.Body>
        <Drawer.Footer borderTopWidth="1px" borderColor="gray.200">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}

// ============================================================================
// Runner Type Card Component
// ============================================================================

type RunnerTypeCardProps = {
  type: RunnerType;
  icon: typeof FileText;
  title: string;
  description: string;
  onClick: () => void;
};

function RunnerTypeCard({ type, icon: Icon, title, description, onClick }: RunnerTypeCardProps) {
  const iconColor = type === "prompt" ? "green" : "blue";
  const iconBg = type === "prompt" ? "green.50" : "blue.50";

  return (
    <Box
      as="button"
      onClick={onClick}
      padding={5}
      borderRadius="lg"
      border="1px solid"
      borderColor="gray.200"
      bg="white"
      textAlign="left"
      width="full"
      _hover={{ borderColor: `${iconColor}.400`, bg: `${iconColor}.50` }}
      transition="all 0.15s"
      data-testid={`runner-type-${type}`}
    >
      <HStack gap={4} align="start">
        <Box
          padding={1}
          borderRadius="md"
          bg={iconBg}
          color={`${iconColor}.600`}
        >
          <Icon size={16} />
        </Box>
        <VStack align="start" gap={1} flex={1}>
          <Text fontWeight="medium">
            {title}
          </Text>
          <Text fontSize="13px" color="gray.600">
            {description}
          </Text>
        </VStack>
      </HStack>
    </Box>
  );
}
