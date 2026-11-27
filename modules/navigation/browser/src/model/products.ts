import { ORGANIZATION_DASHBOARDS_PATH } from "@langwatch/analytics-client";
import type { AuthzPermission } from "@langwatch/authorization";
import type { FrontendFeatureFlag } from "@langwatch/feature-flag-contract";
import { CODING_AGENTS_PATH, RETIRED_PERSONAL_PATH } from "@langwatch/user-contract";
import {
  Boxes,
  Building2,
  Crown,
  LayoutDashboard,
  type LucideIcon,
  UserRound,
  Waypoints,
} from "lucide-react";

/** Product registry; Settings excluded (no switcher, no memory, own shell) */
export type ProductId = "me" | "llm-ops" | "dashboards" | "gateway" | "governance";

export type ProductScopeKind = "personal" | "project" | "organization";

export interface ProductAccessGate {
  flag?: FrontendFeatureFlag;
  permission?: AuthzPermission;
  /** The flag off closes the product's pages too (a 404), not only its menu entry. */
  closesPages?: boolean;
}

export interface ProductDefinition {
  id: ProductId;
  label: string;
  /** One line advertising the functionality, shown in the product switcher. */
  pitch: string;
  icon: LucideIcon;
  scopeKind: ProductScopeKind;
  /**
   * The address the product opens on. Null when the product needs context
   * it does not have yet (LLM Ops without a project); the landing resolver
   * falls through to the next candidate.
   */
  homeHref: (context: { projectSlug?: string | null }) => string | null;
  /** Every gate must pass for the product to be reachable. */
  gates: ProductAccessGate[];
}

// The switcher lists products in this order. Dashboards leads: it is the overview every
// other product feeds, so it is the first place to look.
export const PRODUCTS: readonly ProductDefinition[] = [
  {
    id: "dashboards",
    label: "Dashboards",
    pitch: "Your saved dashboards, in one place",
    icon: LayoutDashboard,
    scopeKind: "project",
    homeHref: ({ projectSlug }) => (projectSlug ? `/${projectSlug}/dashboards` : null),
    gates: [{ flag: "release_dashboards", closesPages: true }, { permission: "analytics:view" }],
  },
  {
    id: "me",
    label: "Coding agents",
    pitch: "Track your coding assistants",
    icon: UserRound,
    scopeKind: "personal",
    homeHref: () => CODING_AGENTS_PATH,
    gates: [{ flag: "release_ui_ai_governance_enabled", closesPages: true }],
  },
  {
    id: "llm-ops",
    label: "LLM Ops",
    pitch: "Observe, evaluate and test your agents",
    icon: Boxes,
    scopeKind: "project",
    homeHref: ({ projectSlug }) => (projectSlug ? `/${projectSlug}` : null),
    gates: [],
  },
  {
    id: "gateway",
    label: "Gateway",
    pitch: "Route, meter and bill LLM usage",
    icon: Waypoints,
    scopeKind: "organization",
    homeHref: () => "/gateway/virtual-keys",
    gates: [{ flag: "release_ui_ai_gateway_menu_enabled" }, { permission: "virtualKeys:view" }],
  },
  {
    id: "governance",
    label: "Governance",
    pitch: "Every AI tool, license, agent and dollar",
    icon: Building2,
    scopeKind: "organization",
    homeHref: () => "/governance",
    gates: [
      { flag: "release_ui_ai_governance_enabled", closesPages: true },
      { permission: "governance:view" },
    ],
  },
];

/**
 * Whether a seat may open a product at all, before any flag or permission is asked.
 * A Developer (ADR-171) owns a personal project and nothing shared, so no
 * organization-wide product is open to them, whatever the permissions say.
 */
export function seatReachesProduct({
  product,
  organizationRole,
}: {
  product: Pick<ProductDefinition, "scopeKind">;
  organizationRole: string | null | undefined;
}): boolean {
  if (organizationRole !== "DEVELOPER") return true;
  return product.scopeKind !== "organization";
}

export function productById(id: ProductId): ProductDefinition {
  const product = PRODUCTS.find((candidate) => candidate.id === id);
  if (!product) throw new Error(`Unknown product id "${id}"`);
  return product;
}

export { ORGANIZATION_DASHBOARDS_PATH };

/** The address without its trailing slashes; a walk, not a regex, so it stays linear. */
function withoutTrailingSlashes(pathname: string): string {
  let end = pathname.length;
  while (end > 0 && pathname[end - 1] === "/") end -= 1;
  return pathname.slice(0, end);
}

/**
 * Whether the address is in the organization's Dashboards area: only the shapes its routes match
 * (the library, `/<id>`, `/templates`, `/curated/<id>`). A deeper page stays the page of a project
 * still holding the slug "dashboards" until `project:reslug-reserved-dashboards` moves it.
 */
export function isOrganizationDashboardsPath(pathname: string): boolean {
  const trimmed = withoutTrailingSlashes(pathname);
  if (!isPathUnder({ pathname: trimmed, base: ORGANIZATION_DASHBOARDS_PATH })) return false;
  const [, page, ...deeper] = trimmed.split("/").filter((segment) => segment !== "");
  return deeper.length === 0 || (page === "curated" && deeper.length === 1);
}

/** Whether the address is the organization's library itself, not a page under it. */
export function isOrganizationLibraryPath(pathname: string): boolean {
  return withoutTrailingSlashes(pathname) === ORGANIZATION_DASHBOARDS_PATH;
}

/**
 * Where a product opens. With the organization's library released, Dashboards opens on it
 * rather than on a project's Dashboards area.
 */
export function productHomeHref({
  product,
  projectSlug,
  hasOrganizationLibrary,
}: {
  product: ProductDefinition;
  projectSlug?: string | null;
  hasOrganizationLibrary: boolean;
}): string | null {
  if (product.id === "dashboards" && hasOrganizationLibrary) return ORGANIZATION_DASHBOARDS_PATH;
  return product.homeHref({ projectSlug });
}

/** Whether a product works inside one project, so the top bar offers the project picker. */
export function isProjectScopedProduct(id: ProductId | null): boolean {
  if (!id) return false;
  return PRODUCTS.find((candidate) => candidate.id === id)?.scopeKind === "project";
}

/** Checks if product is org-scoped; registry owns scope so fifth product means one edit */
export function isOrganizationScopedProduct(id: ProductId | null): boolean {
  if (!id) return false;
  return PRODUCTS.find((candidate) => candidate.id === id)?.scopeKind === "organization";
}

/**
 * Whether an address is a top-level base or sits under it, matched on the
 * segment boundary — a plain `startsWith` would read a project slug like
 * "metadata" as the old /me address, since slugs aren't reserved names.
 */
export function isPathUnder({ pathname, base }: { pathname: string; base: string }): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

/**
 * Which product a browser address belongs to, or null for a non-product
 * page (settings, ops, auth, onboarding, root). Landing memory writes
 * through this, so a null keeps the previous product remembered.
 */
export function productFromPathname(pathname: string): ProductId | null {
  // The legacy /me address is still this product for the one render its
  // redirect to /coding-agents takes, so landing memory is not overwritten.
  if (
    isPathUnder({ pathname, base: CODING_AGENTS_PATH }) ||
    isPathUnder({ pathname, base: RETIRED_PERSONAL_PATH })
  ) {
    return "me";
  }
  if (isPathUnder({ pathname, base: "/gateway" })) return "gateway";
  if (isOrganizationDashboardsPath(pathname)) return "dashboards";
  if (isPathUnder({ pathname, base: "/governance" })) return "governance";
  const nonProductPrefixes = [
    "/settings",
    "/ops",
    "/admin",
    "/auth",
    "/authorize",
    "/onboarding",
    "/invite",
    "/share",
    "/unsubscribe",
    "/cli",
    "/mcp",
    "/@project",
  ];
  const isNonProductPath =
    pathname === "/" ||
    nonProductPrefixes.some((prefix) => isPathUnder({ pathname, base: prefix }));
  if (isNonProductPath) {
    return null;
  }
  // Everything else is a /:project page (including the next-router
  // "/[project]/*" pattern spelling); its Dashboards area is its own product.
  const [, , area] = pathname.split("/");
  return area === "dashboards" ? "dashboards" : "llm-ops";
}

/** The operator console: not a product, so it sits apart in the switcher and its own sidebar. */
export const OPERATIONS_CONSOLE = {
  label: "Operations",
  pitch: "With LangWatch's great features, come great responsibility",
  icon: Crown,
  href: "/ops",
} as const;

/** The operator console (/ops): inside the settings detour, but with its own Admin sidebar. */
export function isAdminShellRoute(pathname: string): boolean {
  return isPathUnder({ pathname, base: "/ops" });
}

/** Settings detour: settings and ops pages; both org-scoped, render the detour's sidebar */
export function isSettingsShellRoute(pathname: string): boolean {
  return isPathUnder({ pathname, base: "/settings" }) || isPathUnder({ pathname, base: "/ops" });
}

/**
 * Detour pages addressed by one organization's entity. Instance pages under
 * `/ops` are not among them: a replay run or an operator belongs to the
 * instance, so its address means the same thing in every organization.
 */
const ENTITY_ADDRESSED_DETOUR_BASES = ["/settings/teams"];

/**
 * Whether a detour address names an entity of the current organization, such
 * as `/settings/teams/:team`. Carrying one into another organization asks it
 * for something it does not have, so a switch cannot keep the reader there.
 */
export function isEntityAddressedDetourRoute(pathname: string): boolean {
  return ENTITY_ADDRESSED_DETOUR_BASES.some((base) => {
    if (!pathname.startsWith(`${base}/`)) return false;
    const [entity] = pathname.slice(base.length + 1).split("/");
    return Boolean(entity);
  });
}
