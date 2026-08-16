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

function readCapturedPath(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return sessionStorage.getItem(RETURN_KEY);
  } catch {
    // storage may be disabled
    return null;
  }
}

function targetFromCapturedPath(): SettingsBackTarget | null {
  const captured = readCapturedPath();
  if (!captured) return null;
  const product = productFromPathname(captured);
  if (!product) return null;
  return { label: `Back to ${productById(product).label}`, href: captured };
}

function targetFromRememberedProduct({
  rememberedProduct,
  reachableProducts,
  projectSlug,
}: {
  rememberedProduct: ProductId | null;
  reachableProducts: readonly ProductId[];
  projectSlug: string | null;
}): SettingsBackTarget | null {
  if (!rememberedProduct) return null;
  if (!reachableProducts.includes(rememberedProduct)) return null;
  const home = productById(rememberedProduct).homeHref({ projectSlug });
  if (!home) return null;
  return {
    label: `Back to ${productById(rememberedProduct).label}`,
    href: home,
  };
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
  return (
    targetFromCapturedPath() ??
    targetFromRememberedProduct({
      rememberedProduct,
      reachableProducts,
      projectSlug,
    }) ?? { label: "Back", href: "/" }
  );
}
