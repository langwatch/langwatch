import {
  Badge,
  Box,
  Button,
  Heading,
  HStack,
  Separator,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Bot, CheckCircle, FileText, Swords } from "lucide-react";
import { LuArrowLeft } from "react-icons/lu";

import { Drawer } from "~/components/ui/drawer";
import type {
  ComparisonEvaluatorConfig,
  TargetConfig,
  TargetType,
} from "~/experiments-v3/types";
import { COMPARISON_EVALUATOR_TYPE } from "~/experiments-v3/types";
import { getComplexProps, useDrawer } from "~/hooks/useDrawer";

// Re-export for backward compatibility
export type { TargetType };

// Card identifiers shown in the picker. "comparison" is a UI-only shortcut
// that creates an evaluator-target pre-configured for the comparison judge —
// the underlying TargetConfig is still type: "evaluator".
type TargetCardKey = TargetType | "comparison";

export type TargetTypeSelectorDrawerProps = {
  open?: boolean;
  onClose?: () => void;
  onSelect?: (type: TargetType) => void;
  /** Passed through to evaluatorEditor when "Comparison" is selected. */
  comparisonContext?: {
    initialComparison?: ComparisonEvaluatorConfig;
    targets: TargetConfig[];
    datasetColumns: { id: string; name: string }[];
  };
};

const targetTypes: Array<{
  type: TargetCardKey;
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
    type: "comparison",
    // Swords identifies "a comparison between columns". A Trophy is reserved
    // for declaring the winner of one.
    icon: Swords,
    title: "Comparison",
    description: "Pairwise or multi-candidate preference judging",
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

  const handleSelectType = (type: TargetCardKey) => {
    // A comparison is a saved evaluator, so it gets the same list-then-create
    // flow as Prompt, Agent and Evaluator: pick one you already have, or make a
    // new one. The list is EvaluatorListDrawer narrowed to comparison
    // evaluators — same component, same cards, same empty state.
    //
    // The save flow (set up by handleAddTarget) creates the column as an
    // evaluator-target either way. comparisonContext is forwarded from
    // handleAddTarget so the creation form shows the variant picker and Golden
    // field immediately, matching edit-mode UX.
    if (type === "comparison") {
      const comparisonContext = (complexProps.comparisonContext ??
        props.comparisonContext) as TargetTypeSelectorDrawerProps["comparisonContext"];

      // NOT `replace: true` — we want the back button in the list and the
      // editor to return to this Add-to-Evaluation picker instead of
      // dead-ending. A `replace` here drops navigation history and the
      // header hides its arrow (canGoBack=false).
      openDrawer("evaluatorList", {
        filterEvaluatorType: COMPARISON_EVALUATOR_TYPE,
        title: "Choose Comparison",
        createLabel: "New Comparison",
        itemLabel: "comparison",
        onCreateNew: () =>
          openDrawer("evaluatorEditor", {
            evaluatorType: COMPARISON_EVALUATOR_TYPE,
            category: "llm_judge",
            comparisonContext,
            saveButtonText: "Add Comparison",
          }),
      });
      return;
    }

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
      modal={false}
    >
      <Drawer.Content bg="bg">
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
  type: TargetCardKey;
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
    type === "prompt"
      ? "green"
      : type === "evaluator"
        ? "green"
        : type === "comparison"
          ? "purple"
          : "blue";
  const iconBg =
    type === "prompt"
      ? "green.subtle"
      : type === "evaluator"
        ? "green.subtle"
        : type === "comparison"
          ? "purple.subtle"
          : "blue.subtle";

  return (
    <VStack align="start">
      {type === "comparison" && (
        <Text fontSize="13px" color="fg.muted">
          Compare existing columns:
        </Text>
      )}
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
            <HStack gap={2}>
              <Text fontWeight="medium">{title}</Text>
              {type === "comparison" && (
                <Badge colorPalette="purple" variant="surface" size="sm">
                  New
                </Badge>
              )}
            </HStack>
            <Text fontSize="13px" color="fg.muted">
              {description}
            </Text>
          </VStack>
        </HStack>
      </Box>
    </VStack>
  );
}
