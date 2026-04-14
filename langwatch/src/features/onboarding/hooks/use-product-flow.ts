import { useRouter } from "~/utils/compat/next-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PRODUCT_FLOW_CONFIG } from "../constants/product-flow";
import {
  OnboardingFlowDirection,
  type ProductFlowConfig,
  ProductScreenIndex,
  type ProductSelection,
} from "../types/types";
import { useGenericOnboardingFlow } from "./use-generic-onboarding-flow";

const VALID_PRODUCTS: ProductSelection[] = [
  "via-claude-code",
  "via-platform",
  "via-claude-desktop",
  "manually",
];

const PRODUCT_TO_SCREEN: Record<ProductSelection, ProductScreenIndex> = {
  "via-claude-code": ProductScreenIndex.VIA_CLAUDE_CODE,
  "via-platform": ProductScreenIndex.VIA_PLATFORM,
  "via-claude-desktop": ProductScreenIndex.VIA_CLAUDE_DESKTOP,
  manually: ProductScreenIndex.MANUALLY,
};

export function useProductFlow() {
  const router = useRouter();
  const [selectedProduct, setSelectedProduct] = useState<
    ProductSelection | undefined
  >(undefined);
  const [flowConfig, setFlowConfig] =
    useState<ProductFlowConfig>(PRODUCT_FLOW_CONFIG);

  // Initialize selected product from URL: prefer product, then step, then slug
  useEffect(() => {
    const productFromQuery = router.query.product;
    const stepFromQuery = router.query.step;

    let inferred: ProductSelection | undefined = undefined;

    if (
      productFromQuery &&
      typeof productFromQuery === "string" &&
      VALID_PRODUCTS.includes(productFromQuery as ProductSelection)
    ) {
      inferred = productFromQuery as ProductSelection;
    } else if (
      stepFromQuery &&
      typeof stepFromQuery === "string" &&
      VALID_PRODUCTS.includes(stepFromQuery as ProductSelection)
    ) {
      inferred = stepFromQuery as ProductSelection;
    } else {
      const currentPath: string =
        typeof router.asPath === "string" ? router.asPath : "";
      const pathNoQuery = currentPath.split("?")[0] ?? "";
      const segments = pathNoQuery
        .split("/")
        .filter((seg): seg is string => !!seg && seg.length > 0);
      const lastSegment =
        segments.length > 0 ? segments[segments.length - 1] : undefined;
      if (
        lastSegment &&
        VALID_PRODUCTS.includes(lastSegment as ProductSelection)
      ) {
        inferred = lastSegment as ProductSelection;
      }
    }

    if (inferred && inferred !== selectedProduct) {
      setSelectedProduct(inferred);
    }
  }, [router.query.product, router.query.step, selectedProduct]);

  // Screen ID mapping for URL query parameters
  const screenIdMap = useMemo(() => {
    const indexToId = new Map<ProductScreenIndex, string>([
      [ProductScreenIndex.SELECTION, "product-selection"],
      [ProductScreenIndex.VIA_CLAUDE_CODE, "via-claude-code"],
      [ProductScreenIndex.VIA_PLATFORM, "via-platform"],
      [ProductScreenIndex.VIA_CLAUDE_DESKTOP, "via-claude-desktop"],
      [ProductScreenIndex.MANUALLY, "manually"],
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
      const productScreen = PRODUCT_TO_SCREEN[selectedProduct];
      setFlowConfig({
        variant: "product",
        visibleScreens: [ProductScreenIndex.SELECTION, productScreen],
        first: ProductScreenIndex.SELECTION,
        last: productScreen,
        total: 2,
      });
    } else {
      setFlowConfig(PRODUCT_FLOW_CONFIG);
    }
  }, [selectedProduct]);

  // Validation - always allow proceeding in product flow
  const canProceed = useCallback(() => true, []);

  // Use generic flow hook for navigation (with URL sync)
  const {
    currentScreenIndex,
    direction,
    navigation,
    canGoBack,
    setCurrentScreenIndex,
  } = useGenericOnboardingFlow(flowConfig, canProceed, {
    queryParamName: "step",
    screenIdMap,
    firstScreenId: "product-selection",
  });

  // If product inferred but step missing, land on product screen and sync URL
  useEffect(() => {
    if (!selectedProduct) return;
    // If user is navigating backward to the selection screen, do not auto-advance
    if (direction === OnboardingFlowDirection.BACKWARD) return;
    if (typeof router.query.step === "string") return;

    setCurrentScreenIndex(PRODUCT_TO_SCREEN[selectedProduct]);
  }, [selectedProduct, router.query.step, direction, setCurrentScreenIndex]);

  // Handle product selection
  const handleSelectProduct = useCallback(
    (product: ProductSelection) => {
      setSelectedProduct(product);

      // Update URL with product parameter, dropping stale product param
      const currentQuery = { ...router.query };
      delete currentQuery.product;
      currentQuery.step = product; // Use product name as step ID

      void router.push(
        {
          pathname: router.pathname,
          query: currentQuery,
        },
        undefined,
        { shallow: true },
      );

      // Navigate to the product screen
      setCurrentScreenIndex(PRODUCT_TO_SCREEN[product]);
    },
    [router, setCurrentScreenIndex],
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
