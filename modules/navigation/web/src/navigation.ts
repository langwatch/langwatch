/** Package exports: the landing screen (/); no page guard (front door principle) */

import type { ComponentType } from "react";

export type NavigationScreenLoader = () => Promise<{ default: ComponentType }>;

/** Navigation screens: landing (/), notFound, projectRedirect; decisions not product surfaces */
export const navigationScreens = {
  landing: () => import("./ui/sections/navigation/landing.screen.tsx"),
  notFound: () => import("./ui/sections/navigation/not-found.screen.tsx"),
  projectRedirect: () => import("./ui/sections/navigation/project-redirect.screen.tsx"),
} as const satisfies Record<string, NavigationScreenLoader>;

export type NavigationScreenName = keyof typeof navigationScreens;

export { navigationApi, type NavigationApiMap } from "./behavior/navigation-api.ts";
export { useLandingRedirect } from "./behavior/use-landing-redirect.ts";
export {
  NavigationHost,
  NavigationHostProvider,
  useNavigationHost,
  useOptionalNavigationHost,
  type NavigationAccountMenu,
  type NavigationCommandBar,
  type NavigationLangy,
  type NavigationDeployment,
  type NavigationFlagReading,
  type NavigationOpsAccess,
  type NavigationOrganization,
  type NavigationPlanReading,
  type NavigationProject,
  type NavigationScopeWrite,
  type NavigationSupportChat,
  type NavigationTeam,
  type NavigationUser,
} from "./model/navigation-host.ts";
export {
  PRODUCTS,
  productById,
  productFromPathname,
  isPathUnder,
  isSettingsShellRoute,
  type ProductDefinition,
  type ProductId,
  type ProductScopeKind,
} from "./model/products.ts";
export { readLastVisitedProduct, writeLastVisitedProduct } from "./model/product-memory.ts";
