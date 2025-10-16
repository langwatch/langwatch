import React from "react";
import { Provider } from "~/components/ui/provider";
import ProductScreen from "~/features/onboarding/screens/ProductScreen";

const OnboardingProduct: React.FC = () => (
  <Provider>
    <ProductScreen />
  </Provider>
);

export default OnboardingProduct;
