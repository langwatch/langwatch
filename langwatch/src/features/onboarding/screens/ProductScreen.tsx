import React, { useMemo } from "react";
import { OrganizationOnboardingContainer } from "../components/containers/OnboardingContainer";
import { AnalyticsBoundary } from "react-contextual-analytics";
import { useProductFlow } from "../hooks/use-product-flow";
import { createProductScreens } from "./create-product-screens";
import { ProductScreenIndex } from "../types/types";

export const ProductScreen: React.FC = () => {
  const {
    selectedProduct,
    currentScreenIndex,
    handleSelectProduct,
  } = useProductFlow();

  const screens = useMemo(
    () => createProductScreens({
      selectedProduct,
      onSelectProduct: handleSelectProduct,
    }),
    [selectedProduct, handleSelectProduct]
  );

  const currentScreen = screens.find((s) => s.id === getScreenId(currentScreenIndex));
  if (!currentScreen) {
    return null;
  }

  return (
    <AnalyticsBoundary name="onboarding_product" sendViewedEvent>
      <OrganizationOnboardingContainer
        title={currentScreen.heading}
        subTitle={currentScreen.subHeading}
      >
        {currentScreen.component}
      </OrganizationOnboardingContainer>
    </AnalyticsBoundary>
  );
};

function getScreenId(index: ProductScreenIndex): string {
  const screenIds: Record<ProductScreenIndex, string> = {
    [ProductScreenIndex.SELECTION]: "product-selection",
    [ProductScreenIndex.OBSERVABILITY]: "observability",
    [ProductScreenIndex.EVALUATIONS]: "evaluations",
    [ProductScreenIndex.PROMPT_MANAGEMENT]: "prompt-management",
    [ProductScreenIndex.AGENT_SIMULATIONS]: "agent-simulations",
  };
  return screenIds[index] ?? "product-selection";
}

export default ProductScreen;
