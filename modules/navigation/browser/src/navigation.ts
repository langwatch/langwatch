/** Package exports: the landing screen (/); no page guard (front door principle) */

/** Navigation screens: landing (/), notFound, projectRedirect; decisions not product surfaces */

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
