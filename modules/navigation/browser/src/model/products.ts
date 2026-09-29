import type { AuthzPermission } from "@langwatch/authz-contract";
import type { FrontendFeatureFlag } from "@langwatch/feature-flag-contract";
import {
  Boxes,
  Building2,
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

export const PRODUCTS: readonly ProductDefinition[] = [
  {
    id: "me",
    label: "Me",
    pitch: "Track your coding assistants",
    icon: UserRound,
    scopeKind: "personal",
    homeHref: () => "/me",
    gates: [{ flag: "release_ui_ai_governance_enabled" }],
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
    id: "dashboards",
    label: "Dashboards",
    pitch: "Your saved dashboards, in one place",
    icon: LayoutDashboard,
    scopeKind: "project",
    homeHref: ({ projectSlug }) => (projectSlug ? `/${projectSlug}/dashboards` : null),
    gates: [{ flag: "release_dashboards" }, { permission: "analytics:view" }],
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
    gates: [{ flag: "release_ui_ai_governance_enabled" }, { permission: "governance:view" }],
  },
];

export function productById(id: ProductId): ProductDefinition {
  const product = PRODUCTS.find((candidate) => candidate.id === id);
  if (!product) throw new Error(`Unknown product id "${id}"`);
  return product;
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
 * "metadata" as the Me product, since slugs aren't reserved names.
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
  if (isPathUnder({ pathname, base: "/me" })) return "me";
  if (isPathUnder({ pathname, base: "/gateway" })) return "gateway";
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

/** Settings detour: settings and ops pages; both org-scoped, render settings sidebar */
export function isSettingsShellRoute(pathname: string): boolean {
  return isPathUnder({ pathname, base: "/settings" }) || isPathUnder({ pathname, base: "/ops" });
}
