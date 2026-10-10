import { PRODUCTS, type ProductId } from "./products.ts";

/** Last product visited per organization (localStorage only); not watched, so no re-renders */
function storageKey(organizationId: string): string {
  return `langwatch:nav:last-product:${organizationId}:v1`;
}

function isProductId(value: unknown): value is ProductId {
  return PRODUCTS.some((product) => product.id === value);
}

export function readLastVisitedProduct({
  organizationId,
}: {
  organizationId: string;
}): ProductId | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(storageKey(organizationId));
    return isProductId(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function writeLastVisitedProduct({
  organizationId,
  productId,
}: {
  organizationId: string;
  productId: ProductId;
}): void {
  if (typeof window === "undefined") return;
  try {
    const key = storageKey(organizationId);
    // Write-on-change only: repeated visits inside the same product must
    // not touch storage (storage events fan out across tabs).
    if (localStorage.getItem(key) === productId) return;
    localStorage.setItem(key, productId);
  } catch {
    // storage may be full / disabled
  }
}
