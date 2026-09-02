/**
 * The navigation controls an application's chrome renders.
 *
 * The two switchers — one for the product, one for the project — plus the
 * vocabulary a chrome needs to place them: which product an address belongs to,
 * what the section rails offer, and where "Back to {product}" goes.
 *
 * Neither switcher reads for itself. The host hands the project switcher its
 * groups and answers both navigations, which is what lets a page that is not
 * the chrome render one too, and is why `projectSwitcher()` can be a real
 * answer rather than a null.
 */

export { ProductSwitcherMenu } from "./blocks/product-switcher-menu";
export { ProjectSwitcherCombobox } from "./blocks/project-switcher-combobox";
export { ProjectAvatar } from "./elements/project-avatar";
export { LogoIcon } from "./elements/logo-icon";
export {
  resolvePickOutcome,
  useProjectPickItems,
  type ProjectPickGroup,
  type ProjectPickItem,
} from "../model/project-pick-items";
export {
  NavigationHostPort,
  NavigationHostProvider,
  useNavigationHost,
  useOptionalNavigationHost,
  type NavigationOrganization,
  type NavigationProject,
  type NavigationTeam,
} from "../model/navigation-host";
export { useNavigationMode, type NavigationModeResolution } from "../behavior/use-navigation-mode";
export { useReachableProducts } from "../behavior/use-reachable-products";
export { useLlmOpsProjectSlug, resolveLlmOpsProjectSlug } from "../behavior/use-llm-ops-project-slug";
export { useIsMobileViewport } from "../behavior/use-is-mobile-viewport";
export { useVisibleSectionNavItems } from "../behavior/use-visible-section-nav-items";
export { QUIET_SIDEBAR_CHIP } from "../model/quiet-chip-style";
export { resolveShellRoute, type ShellRoute } from "../model/resolve-shell-route";
export { resolveOrgSwitchDestination } from "../model/resolve-org-switch-destination";
export {
  captureSettingsReturnPath,
  resolveSettingsBackTarget,
  type SettingsBackTarget,
} from "../model/resolve-settings-back-target";
export {
  gatewayNavItems,
  governanceNavItems,
  type SectionNavItemData,
} from "../model/section-nav-items";
export { productFromPathname, isPathUnder, isSettingsShellRoute } from "../model/products";
export type { ProductDefinition, ProductId } from "../model/products";
