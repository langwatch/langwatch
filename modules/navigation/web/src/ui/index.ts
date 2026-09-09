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

export { NavigationShell } from "./sections/navigation-shell.tsx";
export { ShellPageBody, planManagementHref } from "./sections/shell-page-body.tsx";
export { ProductSidebar, SidebarContent, type SidebarSurface } from "./sections/product-sidebar.tsx";
export { MainMenuSections, MENU_WIDTH_COMPACT, MENU_WIDTH_EXPANDED } from "./sections/main-menu.tsx";
export { PersonalSidebarLinks } from "./sections/personal-sidebar.tsx";
export { AppHeaderUserMenu } from "./sections/app-header-user-menu.tsx";
export { NavigationLink } from "./elements/navigation-link.tsx";
export { SideMenuDensityProvider, useSideMenuDensity } from "./elements/side-menu-density.tsx";
export { ProductSwitcherMenu } from "./sections/product-switcher-menu.tsx";
export { ProjectSwitcherCombobox } from "./blocks/project-switcher-combobox.tsx";
export { ProjectAvatar } from "./elements/project-avatar.tsx";
export { LogoIcon } from "./elements/logo-icon.tsx";
export {
  resolvePickOutcome,
  useProjectPickItems,
  type ProjectPickGroup,
  type ProjectPickItem,
} from "../model/project-pick-items.ts";
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
} from "../model/navigation-host.ts";
export { useNavigationMode } from "../behavior/use-navigation-mode.ts";
export { useNavigationTracking } from "../behavior/use-navigation-tracking.ts";
export { projectSwitchHref, useProjectPickGroups } from "../behavior/use-project-pick-groups.ts";
export { useSettingsMenu } from "../behavior/use-settings-menu.ts";
export {
  settingsMenu,
  isSettingsMenuItemActive,
  opsGroup,
  backofficeGroup,
  type SettingsMenuGates,
  type SettingsMenuGroup,
  type SettingsMenuItem,
} from "../model/settings-menu.ts";
export { featureIcons, recentItemTypeToFeature, type FeatureKey } from "../model/feature-icons.ts";
export { APP_HEADER_HEIGHT } from "../model/menu-widths.ts";
export {
  projectNavItems,
  projectNavItemAt,
  toProjectRoutePattern,
  type ProjectNavItem,
} from "../model/project-nav-items.ts";
export { useReachableProducts } from "../behavior/use-reachable-products.ts";
export {
  useLlmOpsProjectSlug,
  resolveLlmOpsProjectSlug,
} from "../behavior/use-llm-ops-project-slug.ts";
export { useIsMobileViewport } from "../behavior/use-is-mobile-viewport.ts";
export { useVisibleSectionNavItems } from "../behavior/use-visible-section-nav-items.ts";
export { QUIET_SIDEBAR_CHIP } from "../model/quiet-chip-style.ts";
export { resolveShellRoute, type ShellRoute } from "../model/resolve-shell-route.ts";
export { resolveOrgSwitchDestination } from "../model/resolve-org-switch-destination.ts";
export {
  captureSettingsReturnPath,
  resolveSettingsBackTarget,
  type SettingsBackTarget,
} from "../model/resolve-settings-back-target.ts";
export {
  gatewayNavItems,
  governanceNavItems,
  type SectionNavItemData,
} from "../model/section-nav-items.ts";
export { productFromPathname, isPathUnder, isSettingsShellRoute } from "../model/products.ts";
export type { ProductDefinition, ProductId } from "../model/products.ts";
