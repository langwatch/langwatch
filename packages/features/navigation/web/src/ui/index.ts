/**
 * The navigation controls an application's chrome renders.
 *
 * The project switcher is the whole of it today: the combobox, the item shapes
 * it is fed, and the avatar the rows draw. It carries no reads of its own — the
 * host hands it the groups and answers the navigation — which is what lets a
 * page that is not the chrome render it too, and is why `projectSwitcher()` can
 * be a real answer rather than a null.
 */

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
