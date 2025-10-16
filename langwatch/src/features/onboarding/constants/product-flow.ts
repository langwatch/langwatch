import { ProductScreenIndex, type ProductFlowConfig } from "../types/types";

export const PRODUCT_FLOW_CONFIG: ProductFlowConfig = {
  variant: "product",
  visibleScreens: [ProductScreenIndex.SELECTION],
  first: ProductScreenIndex.SELECTION,
  last: ProductScreenIndex.SELECTION,
  total: 1,
};

