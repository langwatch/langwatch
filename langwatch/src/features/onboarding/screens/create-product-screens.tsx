import React, { useMemo } from "react";
import { VStack, Text } from "@chakra-ui/react";
import {
  type OnboardingScreen,
  type ProductSelection,
  ProductScreenIndex,
} from "../types/types";
import { ProductSelectionScreen } from "../components/sections/ProductSelectionScreen";
import { ObservabilityScreen } from "../components/sections/ObservabilityScreen";
import type { ProductFlowConfig } from "../types/types";

// Module-scope screen components
const EvaluationsScreen: React.FC = () => {
  return (
    <VStack gap={4} align="stretch">
      <Text>Coming soon - Evaluations onboarding content.</Text>
    </VStack>
  );
};

const PromptManagementScreen: React.FC = () => {
  return (
    <VStack gap={4} align="stretch">
      <Text>Coming soon - Prompt Management onboarding content.</Text>
    </VStack>
  );
};

const AgentSimulationsScreen: React.FC = () => {
  return (
    <VStack gap={4} align="stretch">
      <Text>Coming soon - Agent Simulations onboarding content.</Text>
    </VStack>
  );
};

interface UseProductScreensProps {
  flow: ProductFlowConfig;
  onSelectProduct: (product: ProductSelection) => void;
}

export const useCreateProductScreens = ({
  flow,
  onSelectProduct,
}: UseProductScreensProps): OnboardingScreen[] => {
  const ProductSelectionScreenWrapped: React.FC = () => (
    <ProductSelectionScreen onSelectProduct={onSelectProduct} />
  );

  const screensBase: Record<ProductScreenIndex, OnboardingScreen> = useMemo(
    () => ({
      [ProductScreenIndex.SELECTION]: {
        id: "product-selection",
        required: false,
        heading: "Pick your flavour",
        subHeading:
          "Choose a starting point. You can explore the rest anytime.",
        component: ProductSelectionScreenWrapped,
      },
      [ProductScreenIndex.OBSERVABILITY]: {
        id: "observability",
        required: false,
        heading: "With Great Power, Comes Great Observability",
        widthVariant: "full",
        component: ObservabilityScreen,
      },
      [ProductScreenIndex.EVALUATIONS]: {
        id: "evaluations",
        required: false,
        heading: "Evaluations",
        subHeading: "Create and run your first evaluation",
        component: EvaluationsScreen,
      },
      [ProductScreenIndex.PROMPT_MANAGEMENT]: {
        id: "prompt-management",
        required: false,
        heading: "Prompt Management",
        subHeading: "Organize and iterate on prompts",
        component: PromptManagementScreen,
      },
      [ProductScreenIndex.AGENT_SIMULATIONS]: {
        id: "agent-simulations",
        required: false,
        heading: "Agent Simulations",
        subHeading: "Simulate scenarios and test agents",
        component: AgentSimulationsScreen,
      },
    }),
    [onSelectProduct]
  );

  return flow.visibleScreens.map((idx) => screensBase[idx]);
};
