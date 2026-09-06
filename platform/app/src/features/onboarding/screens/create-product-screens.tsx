import { useEffect, useMemo, useRef } from "react";
import { useAnalytics } from "react-contextual-analytics";
import { ModelProviderStepScreen } from "../components/sections/ModelProviderStepScreen";
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
  /** Advances past the current screen (the model provider step's save/skip). */
  onContinue: () => void;
}

export const useCreateProductScreens = ({
  flow,
  onSelectProduct,
  onContinue,
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

  // The model provider step keeps credential fields and a pending Codex
  // sign-in mounted across parent re-renders, so its component identity must
  // stay stable: the latest onContinue is read through a ref instead of being
  // a useMemo dependency (the flow rebuilds its navigation callbacks every
  // render, and a new identity here would remount the form mid-typing).
  const onContinueRef = useRef(onContinue);
  useEffect(() => {
    onContinueRef.current = onContinue;
  }, [onContinue]);
  const BoundModelProviderStepScreen = useMemo<React.FC>(
    () =>
      function BoundModelProviderStepScreen() {
        return (
          <ModelProviderStepScreen onContinue={() => onContinueRef.current()} />
        );
      },
    [],
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
        subHeading:
          "Configure everything from the dashboard, no code changes needed",
        widthVariant: "full",
        component: ViaPlatformScreen,
      },
      [ProductScreenIndex.VIA_CLAUDE_DESKTOP]: {
        id: "via-claude-desktop",
        required: false,
        heading: "Connect via MCP",
        subHeading: "Add LangWatch to any MCP-compatible app in under a minute",
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
      [ProductScreenIndex.MODEL_PROVIDER]: {
        id: "model-provider",
        required: false,
        heading: "Set up a model provider",
        subHeading: "Connect the model that powers LangWatch's AI features",
        component: BoundModelProviderStepScreen,
      },
    }),
    [BoundProductSelectionScreen, BoundModelProviderStepScreen],
  );

  return flow.visibleScreens.map((idx) => screensBase[idx]);
};
