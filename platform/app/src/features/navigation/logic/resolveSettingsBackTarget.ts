import { type ProductId, productById, productFromPathname } from "../products";

const RETURN_KEY = "langwatch:nav:settings-return:v1";

/**
 * Where the "Back to {product}" entry at the top of the Settings sidebar
 * goes. Per tab: entering Settings from a product page captures that
 * page in sessionStorage, so two tabs on different products each return
 * to their own place. A fresh tab that opened Settings directly falls
 * back to the remembered product's home, then to the root.
 *
 * Spec: specs/navigation/navigation-v2-landing.feature
 */
export function captureSettingsReturnPath({
  pathname,
  search,
}: {
  pathname: string;
  search?: string;
}): void {
  if (typeof window === "undefined") return;
  if (!productFromPathname(pathname)) return;
  try {
    sessionStorage.setItem(RETURN_KEY, pathname + (search ?? ""));
  } catch {
    // storage may be disabled
  }
}

export interface SettingsBackTarget {
  label: string;
  href: string;
}

export function resolveSettingsBackTarget({
  rememberedProduct,
  reachableProducts,
  projectSlug,
}: {
  rememberedProduct: ProductId | null;
  reachableProducts: readonly ProductId[];
  projectSlug: string | null;
}): SettingsBackTarget {
  if (typeof window !== "undefined") {
    try {
      const captured = sessionStorage.getItem(RETURN_KEY);
      if (captured) {
        const product = productFromPathname(captured);
        if (product) {
          return {
            label: `Back to ${productById(product).label}`,
            href: captured,
          };
        }
      }
    } catch {
      // storage may be disabled
    }
  }

  if (rememberedProduct && reachableProducts.includes(rememberedProduct)) {
    const home = productById(rememberedProduct).homeHref({ projectSlug });
    if (home) {
      return {
        label: `Back to ${productById(rememberedProduct).label}`,
        href: home,
      };
    }
  }

  return { label: "Back", href: "/" };
}
