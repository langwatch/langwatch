import { useUiHostServices } from "@langwatch/browser-host/capabilities";
import { ProductScope } from "@langwatch/design-system/product-scope";
import type { ReactNode } from "react";

import { productFromPathname } from "../../model/products.ts";

/**
 * Declares the product of the address in view, so a routed page, the open drawer and every
 * portal below read one accent. A missing or non-product address is no product, not the last one.
 */
export function ProductAccentScope({ children }: { children?: ReactNode }) {
  const pathname = useUiHostServices().route.reading().pathname;
  const product = pathname ? productFromPathname(pathname) : null;
  return <ProductScope product={product}>{children}</ProductScope>;
}
