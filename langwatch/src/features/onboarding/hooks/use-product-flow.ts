import { useState, useCallback, useEffect, useMemo } from "react";
import { useRouter } from "next/router";
import { ProductScreenIndex, OnboardingFlowDirection, type ProductSelection, type ProductFlowConfig } from "../types/types";
import { PRODUCT_FLOW_CONFIG } from "../constants/product-flow";
import { useGenericOnboardingFlow } from "./use-generic-onboarding-flow";

export function useProductFlow() {
  const router = useRouter();
  const [selectedProduct, setSelectedProduct] = useState<ProductSelection | undefined>(undefined);
  const [flowConfig, setFlowConfig] = useState<ProductFlowConfig>(PRODUCT_FLOW_CONFIG);

  // Initialize selected product from URL: prefer product, then step, then slug
  useEffect(() => {
    const productFromQuery = router.query.product;
    const stepFromQuery = router.query.step;

    const validProducts: ProductSelection[] = [
      "observability",
      "evaluations",
      "prompt-management",
    ];

    let inferred: ProductSelection | undefined = undefined;

    if (productFromQuery && typeof productFromQuery === "string" && validProducts.includes(productFromQuery as ProductSelection)) {
      inferred = productFromQuery as ProductSelection;
    } else if (stepFromQuery && typeof stepFromQuery === "string" && validProducts.includes(stepFromQuery as ProductSelection)) {
      inferred = stepFromQuery as ProductSelection;
    } else {
      const currentPath: string = typeof router.asPath === "string" ? router.asPath : "";
      const pathNoQuery = currentPath.split("?")[0] ?? "";
      const segments = pathNoQuery.split("/").filter((seg): seg is string => !!seg && seg.length > 0);
      const lastSegment = segments.length > 0 ? segments[segments.length - 1] : undefined;
      if (lastSegment && validProducts.includes(lastSegment as ProductSelection)) {
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
      [ProductScreenIndex.OBSERVABILITY, "observability"],
      [ProductScreenIndex.EVALUATIONS, "evaluations"],
      [ProductScreenIndex.PROMPT_MANAGEMENT, "prompt-management"],
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
      const productScreenMap: Record<ProductSelection, ProductScreenIndex> = {
        observability: ProductScreenIndex.OBSERVABILITY,
        evaluations: ProductScreenIndex.EVALUATIONS,
        "prompt-management": ProductScreenIndex.PROMPT_MANAGEMENT,
      };

      const productScreen = productScreenMap[selectedProduct];
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
  const { currentScreenIndex, direction, navigation, canGoBack, setCurrentScreenIndex } =
    useGenericOnboardingFlow(flowConfig, canProceed, {
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

    const productScreenMap: Record<ProductSelection, ProductScreenIndex> = {
      observability: ProductScreenIndex.OBSERVABILITY,
      evaluations: ProductScreenIndex.EVALUATIONS,
      "prompt-management": ProductScreenIndex.PROMPT_MANAGEMENT,
    };
    setCurrentScreenIndex(productScreenMap[selectedProduct]);
  }, [selectedProduct, router.query.step, direction, setCurrentScreenIndex]);

  // Handle product selection
  const handleSelectProduct = useCallback((product: ProductSelection) => {
    setSelectedProduct(product);

    // Update URL with product parameter
    const currentQuery = { ...router.query };
    currentQuery.step = product; // Use product name as step ID

    void router.push(
      {
        pathname: router.pathname,
        query: currentQuery,
      },
      undefined,
      { shallow: true }
    );

    // Navigate to the product screen
    const productScreenMap: Record<ProductSelection, ProductScreenIndex> = {
      observability: ProductScreenIndex.OBSERVABILITY,
      evaluations: ProductScreenIndex.EVALUATIONS,
      "prompt-management": ProductScreenIndex.PROMPT_MANAGEMENT,
    };

    setCurrentScreenIndex(productScreenMap[product]);
  }, [router, setCurrentScreenIndex]);

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
