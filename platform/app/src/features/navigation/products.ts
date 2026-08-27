import { Boxes, Building2, type LucideIcon, UserRound, Waypoints } from "lucide-react";
import type { Permission } from "~/server/api/rbac";
import type { FrontendFeatureFlag } from "@langwatch/feature-flag-contract";

/**
 * The product registry: the platform is four products plus Settings, and
 * every navigation-v2 surface (product switcher, icon rail, sidebars,
 * command bar entries, landing memory) reads this one declaration.
 * Pure data: icons are component references, never JSX, so server-safe
 * logic can import it too.
 *
 * Settings is deliberately NOT a product here: it has no switcher entry,
 * never becomes the remembered product, and gets its own shell.
 */
export type ProductId = "me" | "llm-ops" | "gateway" | "governance";

export type ProductScopeKind = "personal" | "project" | "organization";

export interface ProductAccessGate {
  flag?: FrontendFeatureFlag;
  permission?: Permission;
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
    id: "gateway",
    label: "Gateway",
    pitch: "Route, meter and bill LLM usage",
    icon: Waypoints,
    scopeKind: "organization",
    homeHref: () => "/gateway/virtual-keys",
    gates: [
      { flag: "release_ui_ai_gateway_menu_enabled" },
      { permission: "virtualKeys:view" },
    ],
  },
  {
    id: "governance",
    label: "Governance",
    pitch: "Every AI tool, license, agent and dollar",
    icon: Building2,
    scopeKind: "organization",
    homeHref: () => "/governance",
    gates: [
      { flag: "release_ui_ai_governance_enabled" },
      { permission: "governance:view" },
    ],
  },
];

export function productById(id: ProductId): ProductDefinition {
  const product = PRODUCTS.find((candidate) => candidate.id === id);
  if (!product) throw new Error(`Unknown product id "${id}"`);
  return product;
}

/**
 * Whether an address is a top-level base or sits under it, matched on the
 * segment boundary. A plain `startsWith` would read a project named
 * "metadata" as the Me product and "settings-team" as Settings, because a
 * project slug is a top-level address and those names are not reserved.
 */
export function isPathUnder({
  pathname,
  base,
}: {
  pathname: string;
  base: string;
}): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

/**
 * Which product a browser address belongs to, or null for everything that
 * is not a product page (settings, ops, auth, onboarding, the root).
 * Landing memory writes through this, so a null keeps the previous
 * product remembered; visiting Settings never becomes "where I was".
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
  if (
    pathname === "/" ||
    nonProductPrefixes.some((prefix) => isPathUnder({ pathname, base: prefix }))
  ) {
    return null;
  }
  // Everything else is a /:project page (including the next-router
  // "/[project]/*" pattern spelling).
  return "llm-ops";
}

/**
 * The settings detour: the settings pages and the internal ops pages.
 * Neither is a product. Both render the settings sidebar surface, which
 * is where the ops pages are offered in the new navigation modes, both
 * carry the static Settings title, and both belong to the organization
 * rather than to a project, so the chrome never waits for a project.
 *
 * Spec: specs/navigation/ops-navigation-v2.feature
 */
export function isSettingsShellRoute(pathname: string): boolean {
  return (
    isPathUnder({ pathname, base: "/settings" }) ||
    isPathUnder({ pathname, base: "/ops" })
  );
}
