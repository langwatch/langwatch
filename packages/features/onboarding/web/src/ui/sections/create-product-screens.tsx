/**
 * The screens each product flavour walks through. The model-provider step mounts the
 * model-provider family's own credential form through `model-provider/model-provider-setup`
 * rather than a copy of it, and only the "via the platform" flavour reaches it.
 */
import { useEffect, useMemo, useRef } from "react";
import { useAnalytics } from "react-contextual-analytics";
import { ModelProviderStepScreen } from "./model-provider-step-screen";
import { ObservabilityScreen } from "./observability-screen";
import { ProductSelectionScreen } from "./product-selection-screen";
import { ViaClaudeCodeScreen } from "./via-claude-code-screen";
import { ViaMcpClientScreen } from "./via-claude-desktop-screen";
import { ViaPlatformScreen } from "./via-platform-screen";
import type { ProductFlowConfig } from "../../behavior/types";
import {
  type OnboardingScreen,
  ProductScreenIndex,
  type ProductSelection,
} from "../../behavior/types";

interface ProductSelectionScreenWithAnalyticsProps {
  onSelectProduct: (product: ProductSelection) => void;
}

const ProductSelectionScreenWithAnalytics: React.FC<ProductSelectionScreenWithAnalyticsProps> = ({
  onSelectProduct,
}) => {
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
        return <ProductSelectionScreenWithAnalytics onSelectProduct={onSelectProduct} />;
      },
    [onSelectProduct],
  );

  // The step keeps credential fields and a pending Codex sign-in mounted across
  // the parent's re-renders, so its component identity has to stay stable: the
  // flow rebuilds `onContinue` every render, and a new identity here would
  // remount the form mid-typing.
  const onContinueRef = useRef(onContinue);
  useEffect(() => {
    onContinueRef.current = onContinue;
  }, [onContinue]);
  const BoundModelProviderStepScreen = useMemo<React.FC>(
    () =>
      function BoundModelProviderStepScreen() {
        return <ModelProviderStepScreen onContinue={() => onContinueRef.current()} />;
      },
    [],
  );

  const screensBase: Record<ProductScreenIndex, OnboardingScreen> = useMemo(
    () => ({
      [ProductScreenIndex.SELECTION]: {
        id: "product-selection",
        required: false,
        heading: "Pick your flavour",
        subHeading: "Choose a starting point. You can explore the rest anytime.",
        component: BoundProductSelectionScreen,
      },
      [ProductScreenIndex.VIA_CLAUDE_CODE]: {
        id: "via-claude-code",
        required: false,
        heading: "Via Coding Agent",
        subHeading: "Pick how you want to work with LangWatch in your coding agent",
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
