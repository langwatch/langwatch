/**
 * The Model Provider package's host port, answered from this application.
 *
 * `@langwatch/model-provider-web` declares what its two screens, their table and
 * their confirm dialog need — the scope, one grant, the scopes the reader can
 * see, the address, the two notices, whether a failure was already reported, and
 * the three `platform/app` drawers they address — as one abstract class it can
 * define without importing anything of ours. This is the other half: a plain
 * adapter over what the application shell has already resolved.
 *
 * Nothing here fetches. The values arrive as arguments, so the adapter is a
 * value object a test can construct, and the reads that produce them stay in the
 * one component that mounts it.
 *
 * `openPlatformDrawer` IS THE PLATFORM VOCABULARY THIS FAMILY KEEPS, the same
 * way the agents family kept `openAgentEditor`. The provider editor, the
 * default-model override and the model-cost editor are registered drawers in
 * `platform/app`; two of them have openers outside this family (the evaluator
 * type selector, and the unmapped-cost suggestion in a trace), so the move may
 * not delete them, and a screen may not carry a copy of a drawer registry. The
 * screen names the drawer and this adapter writes the address the rest of the
 * product already produces — the same `?drawer.open=…&drawer.<name>=…` params
 * `openDrawer` writes, including its clearing of every other `drawer.*` key.
 *
 * KNOWN GAP, shared with every family before this one: nothing mounts that
 * registry above a screen served from `apps/ui` until the chrome layout route
 * exists, so the address is right and the drawer does not open yet.
 */

import {
  ModelProviderHostPort,
  type ModelProviderAvailableScopes,
  type ModelProviderFailureNotice,
  type ModelProviderHostScope,
  type ModelProviderPlatformDrawer,
  type ModelProviderRouteReading,
  type ModelProviderSuccessNotice,
} from "@langwatch/model-provider-web/screens/model-provider";

/**
 * The grant neither key carries.
 *
 * Both platform pages were wrapped in `SettingsLayout` and NOTHING else — no
 * `withPermissionGuard`, no flag — and both read `hasPermission("project:manage")`
 * inline to decide whether the write controls are live. Inventing a page-level
 * grant here would refuse readers the product admits today, which is the mistake
 * the datasets family's detail page warned about.
 */
export const MODEL_PROVIDER_PAGE_PERMISSION = void 0;

/** The query parameter that names which drawer the application should open. */
export const DRAWER_OPEN_PARAM = "drawer.open";

export type ModelProviderHostReadings = {
  scope: ModelProviderHostScope;
  availableScopes: ModelProviderAvailableScopes;
  route: ModelProviderRouteReading;
};

export type ModelProviderHostActions = {
  hasPermission: (permission: string) => boolean;
  setQuery: (
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ) => void;
  succeeded: (notice: ModelProviderSuccessNotice) => void;
  failed: (failure: ModelProviderFailureNotice) => void;
};

export class UiModelProviderHost extends ModelProviderHostPort {
  static create(
    readings: ModelProviderHostReadings,
    actions: ModelProviderHostActions,
  ): UiModelProviderHost {
    return new UiModelProviderHost(readings, actions);
  }

  private constructor(
    private readonly readings: ModelProviderHostReadings,
    private readonly actions: ModelProviderHostActions,
  ) {
    super();
  }

  scope(): ModelProviderHostScope {
    return this.readings.scope;
  }

  hasPermission(permission: string): boolean {
    return this.actions.hasPermission(permission);
  }

  availableScopes(): ModelProviderAvailableScopes {
    return this.readings.availableScopes;
  }

  route(): ModelProviderRouteReading {
    return this.readings.route;
  }

  setQuery(
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ): void {
    this.actions.setQuery(next, options);
  }

  succeeded(notice: ModelProviderSuccessNotice): void {
    this.actions.succeeded(notice);
  }

  failed(failure: ModelProviderFailureNotice): void {
    this.actions.failed(failure);
  }

  /**
   * A RECORDED GAP, answered honestly rather than guessed.
   *
   * `platform/app`'s answer is a `WeakSet` that four interceptors on its
   * MutationCache write to, and that cache does not wrap the tRPC client this
   * application builds — so no failure reaching a screen here has been reported
   * anywhere else, and `false` is the true answer for every one of them.
   * Guessing a list of codes instead would suppress a toast for a failure
   * nothing else showed. The same gap the datasets family recorded, and it
   * closes when those interceptors move onto the transport.
   */
  isReportedGlobally(_error: unknown): boolean {
    return false;
  }

  openPlatformDrawer({
    drawer,
    params = {},
  }: {
    drawer: ModelProviderPlatformDrawer;
    params?: Readonly<Record<string, string | undefined>>;
  }): void {
    // Every other `drawer.*` key is dropped, exactly as `openDrawer` does:
    // leaving a previous drawer's parameters behind is what makes an editor open
    // on the row the reader looked at before this one.
    const next: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(this.readings.route.query)) {
      if (!key.startsWith("drawer.")) next[key] = value;
    }
    next[DRAWER_OPEN_PARAM] = drawer;
    for (const [name, value] of Object.entries(params)) {
      if (value !== void 0) next[`drawer.${name}`] = value;
    }
    this.actions.setQuery(next);
  }
}
