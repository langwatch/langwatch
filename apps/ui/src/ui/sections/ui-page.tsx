/**
 * One helper for every routed page: screen, host, settings chrome, guard.
 *
 * The wrapping order is fixed and stated once, here, instead of in 38 route
 * file docblocks: the host is OUTERMOST (a refusal must still have the host
 * mounted for pages that need it before their first render is moot only when
 * there is no host at all), the settings chrome sits outside the guard (a
 * reader who lacks a grant still sees the frame they navigated into), and the
 * guard is innermost, around the screen itself.
 */

import type { ComponentType, ReactNode } from "react";
import type { UiPageLoader } from "../../behavior/ui-page-loaders";
import {
  UiPageForbidden,
  UiPageLoading,
  UiPageNotFound,
} from "../elements/ui-page-fallbacks";
import { withUiPageGuard, type UiPageGuardFallbacks } from "./ui-page-guard";
import { withUiSettingsLayout } from "./ui-settings-layout";

/** The one copy of the guard's fallback trio; every route used to repeat this. */
export const UI_PAGE_FALLBACKS: UiPageGuardFallbacks = {
  loading: UiPageLoading,
  notFound: UiPageNotFound,
  forbidden: UiPageForbidden,
};

export type UiPageInstall = {
  screen: () => Promise<{ default: ComponentType }>;
  host?: ComponentType<{ children: ReactNode }>;
  settingsLayout?: boolean;
  permission?: string;
  flags?: readonly string[];
};

/** Wraps `Page` in `Host`, the way every deleted `withXHost` HOC did. */
export function withHost<P extends object>(
  Host: ComponentType<{ children: ReactNode }>,
  Page: ComponentType<P>,
): ComponentType<P> {
  const Mounted = (props: P) => (
    <Host>
      <Page {...props} />
    </Host>
  );
  Mounted.displayName = `withHost(${Host.displayName ?? Host.name ?? "Host"}, ${
    Page.displayName ?? Page.name ?? "Page"
  })`;
  return Mounted;
}

export function uiPage({
  screen,
  host,
  settingsLayout = false,
  permission,
  flags,
}: UiPageInstall): UiPageLoader {
  return async () => {
    const module = await screen();
    const needsGuard = permission !== void 0 || (flags !== void 0 && flags.length > 0);
    const guarded = needsGuard
      ? withUiPageGuard({ permission, flags, fallbacks: UI_PAGE_FALLBACKS })(module.default)
      : module.default;
    const framed = settingsLayout ? withUiSettingsLayout(guarded) : guarded;
    return { default: host ? withHost(host, framed) : framed };
  };
}
