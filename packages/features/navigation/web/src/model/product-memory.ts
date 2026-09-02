import { PRODUCTS, type ProductId } from "./products";

/**
 * The last product visited, one value per organization, on this device
 * only. A raw localStorage key with no subscribers: the value is read at
 * decision points (landing, settings back target, org switch), never
 * watched, so writing it can never re-render the app mid-navigation
 * (React error #185 class of bugs).
 *
 * Spec: specs/navigation/navigation-v2-product-memory.feature
 */
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
