import type { ReactNode } from "react";

import type { ProductName } from "../../system/product-colours.ts";
import { ProductScopeContext } from "./product-scope.context.ts";

/**
 * Declares which product the subtree belongs to. It draws nothing and wraps nothing; React
 * context crosses portals, so a drawer or menu opened inside keeps the product.
 */
export function ProductScope({
  product,
  children,
}: {
  product: ProductName | null;
  children: ReactNode;
}) {
  return <ProductScopeContext value={product}>{children}</ProductScopeContext>;
}
