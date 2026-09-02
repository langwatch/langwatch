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

export { NavigationShell } from "./sections/navigation-shell";
export { ShellPageBody, planManagementHref } from "./sections/shell-page-body";
export { ProductSidebar, SidebarContent, type SidebarSurface } from "./sections/product-sidebar";
export { MainMenuSections, MENU_WIDTH_COMPACT, MENU_WIDTH_EXPANDED } from "./sections/main-menu";
export { PersonalSidebarLinks } from "./sections/personal-sidebar";
export { AppHeaderUserMenu } from "./sections/app-header-user-menu";
export { NavigationLink } from "./elements/navigation-link";
export { SideMenuDensityProvider, useSideMenuDensity } from "./elements/side-menu-density";
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
  type NavigationAccountMenu,
  type NavigationCommandBar,
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
} from "../model/navigation-host";
export { useNavigationMode, type NavigationModeResolution } from "../behavior/use-navigation-mode";
export { useNavigationTracking } from "../behavior/use-navigation-tracking";
export {
  isNavigationV2ShellRoute,
  useNavigationV2ShellActive,
} from "../behavior/use-navigation-shell-active";
export {
  projectSwitchHref,
  useProjectPickGroups,
} from "../behavior/use-project-pick-groups";
export { useSettingsMenu } from "../behavior/use-settings-menu";
export {
  settingsMenu,
  isSettingsMenuItemActive,
  opsGroup,
  backofficeGroup,
  type SettingsMenuGates,
  type SettingsMenuGroup,
  type SettingsMenuItem,
} from "../model/settings-menu";
export {
  featureIcons,
  recentItemTypeToFeature,
  type FeatureKey,
} from "../model/feature-icons";
export { APP_HEADER_HEIGHT } from "../model/menu-widths";
export {
  projectNavItems,
  projectNavItemAt,
  toProjectRoutePattern,
  type ProjectNavItem,
} from "../model/project-nav-items";
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
