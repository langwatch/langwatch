import { useMemo } from "react";
import { useAnalytics } from "react-contextual-analytics";
import { ObservabilityScreen } from "../components/sections/ObservabilityScreen";
import { ProductSelectionScreen } from "../components/sections/ProductSelectionScreen";
import { ViaClaudeCodeScreen } from "../components/sections/ViaClaudeCodeScreen";
import { ViaMcpClientScreen } from "../components/sections/ViaClaudeDesktopScreen";
import { ViaPlatformScreen } from "../components/sections/ViaPlatformScreen";
import type { ProductFlowConfig } from "../types/types";
import {
  type OnboardingScreen,
  ProductScreenIndex,
  type ProductSelection,
} from "../types/types";

interface ProductSelectionScreenWithAnalyticsProps {
  onSelectProduct: (product: ProductSelection) => void;
}

const ProductSelectionScreenWithAnalytics: React.FC<
  ProductSelectionScreenWithAnalyticsProps
> = ({ onSelectProduct }) => {
  const { emit } = useAnalytics();
  return (
    <ProductSelectionScreen
      onSelectProduct={(product) => {
        emit("selected", "product", { product });
        onSelectProduct(product);
      }}
    />
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
  const BoundProductSelectionScreen = useMemo<React.FC>(
    () =>
      function BoundProductSelectionScreen() {
        return (
          <ProductSelectionScreenWithAnalytics
            onSelectProduct={onSelectProduct}
          />
        );
      },
    [onSelectProduct],
  );

  const screensBase: Record<ProductScreenIndex, OnboardingScreen> = useMemo(
    () => ({
      [ProductScreenIndex.SELECTION]: {
        id: "product-selection",
        required: false,
        heading: "Pick your flavour",
        subHeading:
          "Choose a starting point. You can explore the rest anytime.",
        component: BoundProductSelectionScreen,
      },
      [ProductScreenIndex.VIA_CLAUDE_CODE]: {
        id: "via-claude-code",
        required: false,
        heading: "Via Coding Agent",
        subHeading:
          "Pick how you want to work with LangWatch in your coding agent",
        widthVariant: "full",
        component: ViaClaudeCodeScreen,
      },
      [ProductScreenIndex.VIA_PLATFORM]: {
        id: "via-platform",
        required: false,
        heading: "Via the Platform",
        subHeading: "Configure everything from the dashboard, no code changes needed",
        widthVariant: "full",
        component: ViaPlatformScreen,
      },
      [ProductScreenIndex.VIA_CLAUDE_DESKTOP]: {
        id: "via-claude-desktop",
        required: false,
        heading: "Connect via MCP",
        subHeading:
          "Add LangWatch to any MCP-compatible app in under a minute",
        widthVariant: "full",
        component: ViaMcpClientScreen,
      },
      [ProductScreenIndex.MANUALLY]: {
        id: "manually",
        required: false,
        heading: "Manual Setup",
        subHeading: "Add LangWatch to your codebase in minutes",
        widthVariant: "full",
        component: ObservabilityScreen,
      },
    }),
    [BoundProductSelectionScreen],
  );

  return flow.visibleScreens.map((idx) => screensBase[idx]);
};
