import { type ProductDefinition, productHomeHref } from "../model/products.ts";
import { useLlmOpsProjectSlug } from "./use-llm-ops-project-slug.ts";
import { useOrganizationDashboardsFlags } from "./use-organization-dashboards-area.ts";

/**
 * Whether the organization has the Dashboards library: Dashboards on for the organization
 * (ADR-002), undefined while it loads. The one answer every product home reads.
 */
export function useOrganizationLibrary(): boolean | undefined {
  const area = useOrganizationDashboardsFlags({ enabled: true });
  return area === "loading" ? void 0 : area === "open";
}

/** The library as a yes or no, no while its flags load: for links that may settle later. */
export function useHasOrganizationLibrary(): boolean {
  return useOrganizationLibrary() === true;
}

/**
 * Where the product switcher and the rail open each product. Dashboards has none while the
 * library's flag loads, so a click then opens nothing rather than the wrong Dashboards.
 */
export function useProductHome(): (product: ProductDefinition) => string | null {
  const projectSlug = useLlmOpsProjectSlug();
  const library = useOrganizationLibrary();
  return (product) => {
    if (product.id === "dashboards" && library === void 0) return null;
    return productHomeHref({ product, projectSlug, hasOrganizationLibrary: library === true });
  };
}
