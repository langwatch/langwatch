import { useContext } from "react";

import {
  PRODUCT_COLOURS,
  type ProductAccentPalette,
  type ProductName,
  type ProductRole,
  resolveProductPalette,
} from "../../system/product-colours.ts";
import { ProductScopeContext } from "./product-scope.context.ts";

export interface ProductAccent {
  product: ProductName | null;
  /** The existing palette the product's accent resolves to; gray when the accent is removed. */
  palette: ProductAccentPalette | "gray";
  /** The value for a Chakra `colorPalette` prop: `product.<id>`, or `accent` when unscoped. */
  colorPalette: string;
  /** Token names for each role, e.g. `product.me.fg`; `accent.fg` when unscoped. */
  roles: Record<ProductRole, string>;
}

/** The accent of an explicit product, or the unscoped accent for null. */
export function productAccentOf({ product }: { product: ProductName | null }): ProductAccent {
  const colorPalette = product === null ? "accent" : `product.${product}`;
  const palette =
    product === null ? "accent" : resolveProductPalette({ colour: PRODUCT_COLOURS[product] });
  return {
    product,
    palette,
    colorPalette,
    roles: {
      solid: `${colorPalette}.solid`,
      contrast: `${colorPalette}.contrast`,
      fg: `${colorPalette}.fg`,
      muted: `${colorPalette}.muted`,
      subtle: `${colorPalette}.subtle`,
      emphasized: `${colorPalette}.emphasized`,
      hover: `${colorPalette}.hover`,
      focusRing: `${colorPalette}.focusRing`,
      indicator: `${colorPalette}.indicator`,
      onSolid: `${colorPalette}.onSolid`,
    },
  };
}

/** The accent of the surrounding product scope; consumers never pick a hue by module. */
export function useProductAccent(): ProductAccent {
  return productAccentOf({ product: useContext(ProductScopeContext) });
}
