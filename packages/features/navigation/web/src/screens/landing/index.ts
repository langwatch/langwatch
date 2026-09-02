/**
 * What `/` is, as a package.
 *
 * The screen, the host port it is mounted against, and the one procedure the
 * landing decision reads. Everything else the decision uses — the product
 * registry, the destination rules, the per-device memory — is behind the
 * screen and not part of the seam.
 *
 * ONE SCREEN, ONE ADDRESS: `/`. It carries no page guard, deliberately, for the
 * same reason the front door carries none: the landing address is where a
 * signed-in reader with no idea where to go arrives, and a grant in front of it
 * would be a gate in front of the way in.
 */

import type { ComponentType } from "react";

export type NavigationScreenLoader = () => Promise<{ default: ComponentType }>;

/**
 * The three addresses this package serves.
 *
 * `landing` is `/`. `notFound` is the address that names no page, and
 * `projectRedirect` is `/@project/<rest>` — the link that means "this page, in
 * whichever project I am in". All three are navigation decisions rather than
 * product surfaces, which is why they share one entry point and one host port
 * rather than an export path each.
 */
export const navigationScreens = {
  landing: () => import("./landing.screen"),
  notFound: () => import("../not-found/not-found.screen"),
  projectRedirect: () => import("../project-redirect/project-redirect.screen"),
} as const satisfies Record<string, NavigationScreenLoader>;

export type NavigationScreenName = keyof typeof navigationScreens;

export { navigationApi, type NavigationApiMap } from "../../behavior/navigation-api";
export { useLandingRedirect } from "../../behavior/use-landing-redirect";
export {
  NavigationHostPort,
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
} from "../../model/navigation-host";
export {
  resolveHomeDestination,
  type LastVisitedHomeKind,
} from "../../model/resolve-home-destination";
export {
  PRODUCTS,
  productById,
  productFromPathname,
  isPathUnder,
  isSettingsShellRoute,
  type ProductDefinition,
  type ProductId,
  type ProductScopeKind,
} from "../../model/products";
export { readLastVisitedProduct, writeLastVisitedProduct } from "../../model/product-memory";
