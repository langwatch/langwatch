import { useRouter } from "@langwatch/browser-host/use-router";
import { useCallback, useEffect, useMemo, useState } from "react";

import { PRODUCT_FLOW_CONFIG } from "./product-flow.ts";
import {
  OnboardingFlowDirection,
  type ProductFlowConfig,
  ProductScreenIndex,
  type ProductSelection,
} from "./types.ts";
import { useGenericOnboardingFlow } from "./use-generic-onboarding-flow.ts";

/**
 * The screens each flavour walks through after the selection screen.
 */
const PRODUCT_TO_SCREENS: Record<ProductSelection, [ProductScreenIndex, ...ProductScreenIndex[]]> =
  {
    "via-claude-code": [ProductScreenIndex.VIA_CLAUDE_CODE],
    "via-platform": [ProductScreenIndex.MODEL_PROVIDER, ProductScreenIndex.VIA_PLATFORM],
    "via-claude-desktop": [ProductScreenIndex.VIA_CLAUDE_DESKTOP],
    manually: [ProductScreenIndex.MANUALLY],
  };

const firstScreenFor = (product: ProductSelection): ProductScreenIndex =>
  PRODUCT_TO_SCREENS[product][0];

function isProductSelection(value: unknown): value is ProductSelection {
  return (
    value === "via-claude-code" ||
    value === "via-platform" ||
    value === "via-claude-desktop" ||
    value === "manually"
  );
}

function inferProductFromPath(path: unknown): ProductSelection | undefined {
  if (typeof path !== "string") return undefined;

  const pathNoQuery = path.split("?")[0] ?? "";
  const segments = pathNoQuery.split("/").filter((segment) => segment.length > 0);
  const lastSegment = segments.at(-1);

  return isProductSelection(lastSegment) ? lastSegment : undefined;
}

function inferProductSelection({
  product,
  step,
  path,
}: {
  product: unknown;
  step: unknown;
  path: unknown;
}): ProductSelection | undefined {
  if (isProductSelection(product)) return product;
  if (isProductSelection(step)) return step;
  return inferProductFromPath(path);
}

export function useProductFlow() {
  const router = useRouter();
  const [selectedProduct, setSelectedProduct] = useState<ProductSelection | undefined>(undefined);
  const [flowConfig, setFlowConfig] = useState<ProductFlowConfig>(PRODUCT_FLOW_CONFIG);

  // Initialize selected product from URL: prefer product, then step, then slug
  useEffect(() => {
    const inferred = inferProductSelection({
      product: router.query.product,
      step: router.query.step,
      path: router.asPath,
    });

    if (inferred && inferred !== selectedProduct) {
      setSelectedProduct(inferred);
    }
  }, [router.query.product, router.query.step, router.asPath, selectedProduct]);

  // Screen ID mapping for URL query parameters
  const screenIdMap = useMemo(() => {
    const indexToId = new Map<ProductScreenIndex, string>([
      [ProductScreenIndex.SELECTION, "product-selection"],
      [ProductScreenIndex.VIA_CLAUDE_CODE, "via-claude-code"],
      [ProductScreenIndex.VIA_PLATFORM, "via-platform"],
      [ProductScreenIndex.VIA_CLAUDE_DESKTOP, "via-claude-desktop"],
      [ProductScreenIndex.MANUALLY, "manually"],
      [ProductScreenIndex.MODEL_PROVIDER, "model-provider"],
    ]);

    const idToIndex = new Map<string, ProductScreenIndex>();
    indexToId.forEach((id, index) => {
      idToIndex.set(id, index);
    });

    return { indexToId, idToIndex };
  }, []);

  // Update flow config when product is selected
  useEffect(() => {
    if (selectedProduct) {
      const productScreens = PRODUCT_TO_SCREENS[selectedProduct];
      setFlowConfig({
        variant: "product",
        visibleScreens: [ProductScreenIndex.SELECTION, ...productScreens],
        first: ProductScreenIndex.SELECTION,
        last: productScreens[productScreens.length - 1] ?? productScreens[0],
        total: 1 + productScreens.length,
      });
    } else {
      setFlowConfig(PRODUCT_FLOW_CONFIG);
    }
  }, [selectedProduct]);

  // Validation - always allow proceeding in product flow
  const canProceed = useCallback(() => true, []);

  // Use generic flow hook for navigation (with URL sync)
  const { currentScreenIndex, direction, navigation, canGoBack, setCurrentScreenIndex } =
    useGenericOnboardingFlow(flowConfig, canProceed, {
      queryParamName: "step",
      screenIdMap,
      firstScreenId: "product-selection",
    });

  // If product inferred but step missing, land on the flavour's first screen
  // after selection and sync URL
  useEffect(() => {
    if (!selectedProduct) return;
    // If user is navigating backward to the selection screen, do not auto-advance
    if (direction === OnboardingFlowDirection.BACKWARD) return;
    if (typeof router.query.step === "string") return;

    setCurrentScreenIndex(firstScreenFor(selectedProduct));
  }, [selectedProduct, router.query.step, direction, setCurrentScreenIndex]);

  // Handle product selection
  const handleSelectProduct = useCallback(
    (product: ProductSelection) => {
      setSelectedProduct(product);

      const firstScreen = firstScreenFor(product);
      const stepId = screenIdMap.indexToId.get(firstScreen) ?? product;

      // Update URL, dropping stale product param
      const currentQuery = { ...router.query };
      delete currentQuery.product;
      currentQuery.step = stepId;
      // When the flavour starts on an intermediate step (model-provider),
      // the step id alone no longer names the flavour: keep it in the
      // product param so a reload restores the full flow.
      if (stepId !== product) {
        currentQuery.product = product;
      }

      // Navigate to the flavour's first screen after selection. This pushes
      // a URL from a query snapshot that predates the product param, so the
      // full push below must come after it to win the final URL.
      setCurrentScreenIndex(firstScreen);

      void router.push(
        {
          pathname: router.pathname,
          query: currentQuery,
        },
        undefined,
        { shallow: true },
      );
    },
    [router, screenIdMap, setCurrentScreenIndex],
  );

  return {
    selectedProduct,
    currentScreenIndex,
    direction,
    flow: flowConfig,
    navigation,
    canGoBack,
    handleSelectProduct,
  };
}
