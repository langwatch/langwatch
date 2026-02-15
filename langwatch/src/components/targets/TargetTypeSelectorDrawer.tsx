import { Box, Button, Heading, HStack, Separator, Text, VStack } from "@chakra-ui/react";
import { Bot, CheckCircle, FileText } from "lucide-react";
import { LuArrowLeft } from "react-icons/lu";

import { Drawer } from "~/components/ui/drawer";
import type { TargetType } from "~/evaluations-v3/types";
import { getComplexProps, useDrawer } from "~/hooks/useDrawer";

// Re-export for backward compatibility
export type { TargetType };

export type TargetTypeSelectorDrawerProps = {
  open?: boolean;
  onClose?: () => void;
  onSelect?: (type: TargetType) => void;
};

const targetTypes: Array<{
  type: TargetType;
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
  {
    type: "evaluator",
    icon: CheckCircle,
    title: "Evaluator",
    description: "Test an evaluator against a dataset",
  },
];

/**
 * Drawer for selecting the type of target to add to an evaluation.
 * Shows cards for Prompt vs Agent with icons and descriptions.
 */
export function TargetTypeSelectorDrawer(props: TargetTypeSelectorDrawerProps) {
  const { closeDrawer, openDrawer, canGoBack, goBack } = useDrawer();
  const complexProps = getComplexProps();

  const onClose = props.onClose ?? closeDrawer;
  const onSelect =
    props.onSelect ??
    (complexProps.onSelect as TargetTypeSelectorDrawerProps["onSelect"]);
  const isOpen = props.open !== false && props.open !== undefined;

  const handleSelectType = (type: TargetType) => {
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
      } else if (type === "evaluator") {
        openDrawer("evaluatorList", {}, { replace: true });
      }
    }
  };

  return (
    <Drawer.Root
      open={isOpen}
      onOpenChange={({ open }) => !open && onClose()}
      size="md"
      closeOnInteractOutside={false}
      modal={false}
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
        <Drawer.Body
          display="flex"
          flexDirection="column"
          overflow="hidden"
          padding={0}
        >
          <VStack gap={4} align="stretch" flex={1} overflow="hidden">
            <Text color="fg.muted" fontSize="sm" paddingX={6} paddingTop={4}>
              Choose what you want to evaluate - a prompt from your library or a
              custom agent.
            </Text>

            {/* Target type cards */}
            <VStack gap={3} align="stretch" paddingX={6} paddingBottom={4}>
              {targetTypes.map((targetType) => (
                <TargetTypeCard
                  key={targetType.type}
                  {...targetType}
                  onClick={() => handleSelectType(targetType.type)}
                />
              ))}
            </VStack>
          </VStack>
        </Drawer.Body>
        <Drawer.Footer borderTopWidth="1px" borderColor="border">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}

// ============================================================================
// Target Type Card Component
// ============================================================================

type TargetTypeCardProps = {
  type: TargetType;
  icon: typeof FileText;
  title: string;
  description: string;
  onClick: () => void;
};

function TargetTypeCard({
  type,
  icon: Icon,
  title,
  description,
  onClick,
}: TargetTypeCardProps) {
  const iconColor =
    type === "prompt" ? "green" : type === "evaluator" ? "green" : "blue";
  const iconBg =
    type === "prompt"
      ? "green.subtle"
      : type === "evaluator"
        ? "green.subtle"
        : "blue.subtle";

  return (
    <VStack align="start">
      {type === "evaluator" && (
        <Text fontSize="13px" color="fg.muted">
          Or evaluate an evaluator:
        </Text>
      )}
      <Box
        as="button"
        onClick={onClick}
        padding={5}
        borderRadius="lg"
        border="1px solid"
        borderColor="border"
        bg="bg.panel"
        textAlign="left"
        width="full"
        _hover={{
          borderColor: `${iconColor}.muted`,
          bg: `${iconColor}.subtle`,
        }}
        transition="all 0.15s"
        data-testid={`target-type-${type}`}
      >
        <HStack gap={4} align="start">
          <Box
            padding={1}
            borderRadius="md"
            bg={iconBg}
            color={`${iconColor}.fg`}
          >
            <Icon size={16} />
          </Box>
          <VStack align="start" gap={1} flex={1}>
            <Text fontWeight="medium">{title}</Text>
            <Text fontSize="13px" color="fg.muted">
              {description}
            </Text>
          </VStack>
        </HStack>
      </Box>
    </VStack>
  );
}
