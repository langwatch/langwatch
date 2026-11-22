import { createContext } from "react";

import type { ProductName } from "../../system/product-colours.ts";

/** The product the surface belongs to; null outside any product keeps the unscoped accent. */
export const ProductScopeContext = createContext<ProductName | null>(null);
