import { UiDesignSystemShell } from "@langwatch/ui";
import { uiDesignSystem } from "@langwatch/ui/design-system";
import type React from "react";
import ProductScreen from "~/features/onboarding/screens/ProductScreen";

const OnboardingProduct: React.FC = () => (
  <UiDesignSystemShell system={uiDesignSystem}>
    <ProductScreen />
  </UiDesignSystemShell>
);

export default OnboardingProduct;
