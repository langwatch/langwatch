/**
 * Which page keys the onboarding addresses answer, and what they are wrapped in.
 *
 * FIVE KEYS, FIVE SCREENS, TWO DIFFERENT FRAMES — and the split is the family.
 *
 *   `/onboarding`, `/onboarding/welcome`, `/onboarding/product` and
 *   `/onboarding/:team/project` are OUTSIDE the application chrome, exactly where
 *   the route table puts them: these are the addresses a reader with no project
 *   reaches, and a project switcher above a page whose whole subject is not
 *   having one would be a control with nothing in it. They get the host and
 *   nothing else. The `UiDesignSystemShell` two of the platform pages wrapped
 *   themselves in did NOT travel and is not restored here: `ui-outer-providers`
 *   already mounts it above every route, so a second one was always redundant.
 *
 *   `/:project/setup` is inside the chrome, like every other project-scoped
 *   address, and it is the only key here that carries a guard.
 *
 * FOUR KEYS CARRY NO PAGE-LEVEL GRANT, which is the platform pages' policy one
 * for one: none of the four had a `withPermissionGuard`, and they could not — a
 * grant is resolved against a scope, and a reader arriving at
 * `/onboarding/welcome` has none yet. `/:project/setup` had
 * `withPermissionGuard("project:view", { layoutComponent: DashboardLayout })`
 * and keeps exactly that grant; the layout half is the chrome layout route's now.
 */

import { onboardingScreens } from "@langwatch/onboarding-web/screens/onboarding";
import type { ComponentType } from "react";
import type { UiPageLoader, UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";
import {
  UiPageForbidden,
  UiPageLoading,
  UiPageNotFound,
} from "../../../../ui/elements/ui-page-fallbacks";
import { withUiPageGuard } from "../../../../ui/sections/ui-page-guard";
import { withOnboardingHost } from "./onboarding-host-provider";

const FALLBACKS = {
  loading: UiPageLoading,
  notFound: UiPageNotFound,
  forbidden: UiPageForbidden,
};

/** The grant `/:project/setup` carried, and the only one in this family. */
export const SETUP_PAGE_PERMISSION = "project:view";

function unguarded(load: () => Promise<{ default: ComponentType }>): UiPageLoader {
  return async () => {
    const module = await load();
    return { default: withOnboardingHost(module.default) };
  };
}

const setupPage: UiPageLoader = async () => {
  const module = await onboardingScreens.setup();
  const guarded = withUiPageGuard({
    permission: SETUP_PAGE_PERMISSION,
    fallbacks: FALLBACKS,
  })(module.default as ComponentType);
  return { default: withOnboardingHost(guarded) };
};

export const onboardingPageLoaders: UiPageLoaderRegistry = {
  "pages/onboarding": unguarded(onboardingScreens.onboarding),
  "pages/onboarding/welcome": unguarded(onboardingScreens.welcome),
  "pages/onboarding/product/index": unguarded(onboardingScreens.product),
  "pages/onboarding/[team]/project": unguarded(onboardingScreens.project),
  "pages/[project]/setup": setupPage,
};
