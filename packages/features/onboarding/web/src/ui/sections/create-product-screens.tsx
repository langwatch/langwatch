/**
 * The screens each product flavour walks through.
 *
 * ONE SCREEN DID NOT TRAVEL: the model-provider setup step. It mounts
 * `platform/app`'s model-provider credential form, which reaches four
 * `components/settings/*` modules, `~/server/api/rbac` and `utils/modelProviderSync`
 * — the model-provider family's own closure, moving in a different slice — so
 * taking it here would have been a copy of another family's page. It was
 * SKIPPABLE by design and only the "via the platform" flavour reached it, so
 * that flavour now goes straight to its setup screen; `use-product-flow` records
 * the same thing at the routing table. The enum value and the screen entry stay
 * so reinstating it is one import and one component.
 */
import { useMemo } from "react";
import { useAnalytics } from "react-contextual-analytics";
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
        return <ProductSelectionScreenWithAnalytics onSelectProduct={onSelectProduct} />;
      },
    [onSelectProduct],
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
      // MODEL_PROVIDER IS NOT SERVED HERE — see the module docblock. The index
      // stays in the enum so the URL vocabulary is unchanged and reinstating it
      // is one entry.
      [ProductScreenIndex.MODEL_PROVIDER]: {
        id: "model-provider",
        required: false,
        heading: "Set up a model provider",
        subHeading: "Connect the model that powers LangWatch's AI features",
        component: ViaPlatformScreen,
      },
    }),
    [BoundProductSelectionScreen],
  );

  return flow.visibleScreens.map((idx) => screensBase[idx]);
};
