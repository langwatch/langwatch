import { useState, useCallback, useEffect, useMemo } from "react";
import { useRouter } from "next/router";
import { ProductScreenIndex, type ProductSelection, type ProductFlowConfig } from "../types/types";
import { PRODUCT_FLOW_CONFIG } from "../constants/product-flow";
import { useGenericOnboardingFlow } from "./use-generic-onboarding-flow";

export function useProductFlow() {
  const router = useRouter();
  const [selectedProduct, setSelectedProduct] = useState<ProductSelection | undefined>(undefined);
  const [flowConfig, setFlowConfig] = useState<ProductFlowConfig>(PRODUCT_FLOW_CONFIG);

  // Initialize selected product from URL query param
  useEffect(() => {
    const productFromQuery = router.query.product;
    if (productFromQuery && typeof productFromQuery === "string") {
      const validProducts: ProductSelection[] = [
        "observability",
        "evaluations",
        "prompt-management",
        "agent-simulations",
      ];
      if (validProducts.includes(productFromQuery as ProductSelection)) {
        setSelectedProduct(productFromQuery as ProductSelection);
      }
    }
  }, [router.query.product]);

  // Screen ID mapping for URL query parameters
  const screenIdMap = useMemo(() => {
    const indexToId = new Map<ProductScreenIndex, string>([
      [ProductScreenIndex.SELECTION, "product-selection"],
      [ProductScreenIndex.OBSERVABILITY, "observability"],
      [ProductScreenIndex.EVALUATIONS, "evaluations"],
      [ProductScreenIndex.PROMPT_MANAGEMENT, "prompt-management"],
      [ProductScreenIndex.AGENT_SIMULATIONS, "agent-simulations"],
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
        "agent-simulations": ProductScreenIndex.AGENT_SIMULATIONS,
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
  const { currentScreenIndex, direction, navigation, setCurrentScreenIndex } =
    useGenericOnboardingFlow(flowConfig, canProceed, {
      queryParamName: "step",
      screenIdMap,
    });

  // Handle product selection
  const handleSelectProduct = useCallback((product: ProductSelection) => {
    setSelectedProduct(product);

    // Update URL with product parameter
    const currentQuery = { ...router.query };
    currentQuery.product = product;
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
      "agent-simulations": ProductScreenIndex.AGENT_SIMULATIONS,
    };

    setCurrentScreenIndex(productScreenMap[product]);
  }, [router, setCurrentScreenIndex]);

  return {
    selectedProduct,
    currentScreenIndex,
    direction,
    flow: flowConfig,
    navigation,
    handleSelectProduct,
  };
}

