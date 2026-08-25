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
interface CapturedReturn {
  organizationId: string | null;
  pathname: string;
  search: string;
}

export function captureSettingsReturnPath({
  organizationId,
  pathname,
  search,
}: {
  organizationId: string | null;
  pathname: string;
  search?: string;
}): void {
  if (typeof window === "undefined") return;
  if (!productFromPathname(pathname)) return;
  const captured: CapturedReturn = {
    organizationId,
    pathname,
    search: search ?? "",
  };
  try {
    sessionStorage.setItem(RETURN_KEY, JSON.stringify(captured));
  } catch {
    // storage may be disabled
  }
}

export interface SettingsBackTarget {
  label: string;
  href: string;
}

function readCapturedReturn(): CapturedReturn | null {
  if (typeof window === "undefined") return null;
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(RETURN_KEY);
  } catch {
    // storage may be disabled
    return null;
  }
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { organizationId, pathname, search } = parsed as CapturedReturn;
    if (typeof pathname !== "string") return null;
    return {
      organizationId: typeof organizationId === "string" ? organizationId : null,
      pathname,
      search: typeof search === "string" ? search : "",
    };
  } catch {
    return null;
  }
}

/**
 * The captured page, only when it still belongs to the organization the
 * user is in. An organization switch inside Settings makes the captured
 * project address belong to somewhere else, so it is dropped.
 */
function targetFromCapturedPath(
  currentOrganizationId: string | null,
): SettingsBackTarget | null {
  const captured = readCapturedReturn();
  if (!captured) return null;
  if (captured.organizationId !== currentOrganizationId) return null;
  // Classification reads the pathname only; the query belongs to the
  // address the user returns to, not to the product test.
  const product = productFromPathname(captured.pathname);
  if (!product) return null;
  return {
    label: `Back to ${productById(product).label}`,
    href: captured.pathname + captured.search,
  };
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
  organizationId,
  rememberedProduct,
  reachableProducts,
  projectSlug,
}: {
  organizationId: string | null;
  rememberedProduct: ProductId | null;
  reachableProducts: readonly ProductId[];
  projectSlug: string | null;
}): SettingsBackTarget {
  return (
    targetFromCapturedPath(organizationId) ??
    targetFromRememberedProduct({
      rememberedProduct,
      reachableProducts,
      projectSlug,
    }) ?? { label: "Back", href: "/" }
  );
}
