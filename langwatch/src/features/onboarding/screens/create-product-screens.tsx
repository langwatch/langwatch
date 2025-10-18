import React from "react";
import { VStack, Text } from "@chakra-ui/react";
import {
  type OnboardingScreen,
  type ProductSelection,
  ProductScreenIndex,
} from "../types/types";
import { ProductSelectionScreen } from "../components/sections/ProductSelectionScreen";
import { ObservabilityScreen } from "../components/sections/ObservabilityScreen";
import type { RouterOutputs } from "~/utils/api";

interface ProductScreensProps {
  selectedProduct: ProductSelection | undefined;
  onSelectProduct: (product: ProductSelection) => void;
  project?: RouterOutputs["organization"]["getAll"][number]["teams"][number]["projects"][number] | undefined;
}

export function createProductScreens({
  selectedProduct,
  onSelectProduct,
  project,
}: ProductScreensProps): OnboardingScreen[] {

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

  const screens: Record<ProductScreenIndex, OnboardingScreen> = {
    [ProductScreenIndex.SELECTION]: {
      id: "product-selection",
      required: false,
      heading: "Pick your flavour",
      subHeading: "Choose a starting point. You can explore the rest anytime.",
      component: <ProductSelectionScreen onSelectProduct={onSelectProduct} />,
    },
    [ProductScreenIndex.OBSERVABILITY]: {
      id: "observability",
      required: false,
      heading: "With Great Power, Comes Great Observability",
      component: <ObservabilityScreen />,
    },
    [ProductScreenIndex.EVALUATIONS]: {
      id: "evaluations",
      required: false,
      heading: "Evaluations",
      subHeading: "Create and run your first evaluation",
      component: <EvaluationsScreen />,
    },
    [ProductScreenIndex.PROMPT_MANAGEMENT]: {
      id: "prompt-management",
      required: false,
      heading: "Prompt Management",
      subHeading: "Organize and iterate on prompts",
      component: <PromptManagementScreen />,
    },
    [ProductScreenIndex.AGENT_SIMULATIONS]: {
      id: "agent-simulations",
      required: false,
      heading: "Agent Simulations",
      subHeading: "Simulate scenarios and test agents",
      component: <AgentSimulationsScreen />,
    },
  };

  // Return screens based on flow config
  if (selectedProduct) {
    const productScreenMap: Record<ProductSelection, ProductScreenIndex> = {
      observability: ProductScreenIndex.OBSERVABILITY,
      evaluations: ProductScreenIndex.EVALUATIONS,
      "prompt-management": ProductScreenIndex.PROMPT_MANAGEMENT,
      "agent-simulations": ProductScreenIndex.AGENT_SIMULATIONS,
    };

    return [
      screens[ProductScreenIndex.SELECTION],
      screens[productScreenMap[selectedProduct]],
    ];
  }

  return [screens[ProductScreenIndex.SELECTION]];
}

