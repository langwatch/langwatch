/**
 * The wrapping order, fixed once here instead of in 38 route files: host OUTERMOST (a
 * page needs it mounted before first render even when refused), guard innermost around
 * the screen.
 */

import type { ComponentType, ReactNode } from "react";
import type { UiPageLoader } from "../../behavior/ui-page-loaders";
import { UiPageForbidden, UiPageLoading, UiPageNotFound } from "./ui-page-fallbacks";
import { withUiPageGuard, type UiPageGuardFallbacks } from "./ui-page-guard";

/** The one copy of the guard's fallback trio; every route used to repeat this. */
export const UI_PAGE_FALLBACKS: UiPageGuardFallbacks = {
  loading: UiPageLoading,
  notFound: UiPageNotFound,
  forbidden: UiPageForbidden,
};

export type UiPageInstall = {
  screen: () => Promise<{ default: ComponentType }>;
  host?: ComponentType<{ children: ReactNode }>;
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

export function uiPage({ screen, host, permission, flags }: UiPageInstall): UiPageLoader {
  return async () => {
    const module = await screen();
    const needsGuard = permission !== void 0 || (flags !== void 0 && flags.length > 0);
    const guarded = needsGuard
      ? withUiPageGuard({ permission, flags, fallbacks: UI_PAGE_FALLBACKS })(module.default)
      : module.default;
    return { default: host ? withHost(host, guarded) : guarded };
  };
}
