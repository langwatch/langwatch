import { useMemo } from "react";
import { ObservabilityScreen } from "../components/sections/ObservabilityScreen";
import { ProductSelectionScreen } from "../components/sections/ProductSelectionScreen";
import { ViaClaudeCodeScreen } from "../components/sections/ViaClaudeCodeScreen";
import { ViaClaudeDesktopScreen } from "../components/sections/ViaClaudeDesktopScreen";
import { ViaPlatformScreen } from "../components/sections/ViaPlatformScreen";
import type { ProductFlowConfig } from "../types/types";
import {
  type OnboardingScreen,
  ProductScreenIndex,
  type ProductSelection,
} from "../types/types";

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
      [ProductScreenIndex.VIA_CLAUDE_CODE]: {
        id: "via-claude-code",
        required: false,
        heading: "Via Claude Code",
        subHeading: "Set up LangWatch with Claude Code",
        widthVariant: "full",
        component: ViaClaudeCodeScreen,
      },
      [ProductScreenIndex.VIA_PLATFORM]: {
        id: "via-platform",
        required: false,
        heading: "Via the Platform",
        subHeading: "Configure through the dashboard",
        widthVariant: "full",
        component: ViaPlatformScreen,
      },
      [ProductScreenIndex.VIA_CLAUDE_DESKTOP]: {
        id: "via-claude-desktop",
        required: false,
        heading: "Via Claude Desktop",
        subHeading: "Connect via Claude Desktop",
        widthVariant: "full",
        component: ViaClaudeDesktopScreen,
      },
      [ProductScreenIndex.MANUALLY]: {
        id: "manually",
        required: false,
        heading: "Manual Setup",
        subHeading: "Integrate the SDK manually",
        widthVariant: "full",
        component: ObservabilityScreen,
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onSelectProduct],
  );

  return flow.visibleScreens.map((idx) => screensBase[idx]);
};
