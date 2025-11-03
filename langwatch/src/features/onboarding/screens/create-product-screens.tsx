import React, { useMemo } from "react";
import { VStack, Text } from "@chakra-ui/react";
import {
  type OnboardingScreen,
  type ProductSelection,
  ProductScreenIndex,
} from "../types/types";
import { ProductSelectionScreen } from "../components/sections/ProductSelectionScreen";
import { ObservabilityScreen } from "../components/sections/ObservabilityScreen";
import { ModelProviderScreen } from "../components/sections/ModelProviderScreen";
import type { ProductFlowConfig } from "../types/types";

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
        heading: "Eval yourself before you wreck yourself",
        subHeading: "You'll need to connect LangWatch to your model provider to run evaluations",
        component: ModelProviderScreen,
      },
      [ProductScreenIndex.PROMPT_MANAGEMENT]: {
        id: "prompt-management",
        required: false,
        heading: "With great prompts comes great responses",
        subHeading: "Enhance",
        component: ModelProviderScreen,
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onSelectProduct],
  );

  return flow.visibleScreens.map((idx) => screensBase[idx]);
};
