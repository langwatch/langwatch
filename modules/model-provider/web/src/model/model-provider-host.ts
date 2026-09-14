/**
 * What the Model Providers and Model Costs screens ask of the application they are mounted in,
 * since ADR-004 seals a feature-web package off from `@langwatch/ui`, the router, toasts and the
 * session client. `openPlatformDrawer` exists because three overlays are `platform/app` drawers
 * with outside callers, so a screen only names the drawer and the host writes the address.
 */

import { createContext, useContext } from "react";

/** The organization, team and project the address is about. */
export type ModelProviderHostScope = {
  organizationId: string | undefined;
  teamId: string | undefined;
  projectId: string | undefined;
  /**
   * The project's slug, used by the cost drawer's matching-spans preview to link each sample
   * to `/<projectSlug>/traces?...`. Undefined keeps the row un-clickable instead of linking to
   * `/undefined`.
   */
  projectSlug: string | undefined;
};

/**
 * The organization, teams and projects the reader can see — used by the scope filter and by a
 * provider row's scope chips. Declared structurally rather than importing `AvailableScopes`
 * from `@langwatch/authz-web`, to avoid a second `ui-screen-closure` finding for a shape the
 * port can spell out itself.
 */
export type ModelProviderAvailableScopes = {
  organization: { id: string; name: string } | null;
  teams: Array<{ id: string; name: string }>;
  projects: Array<{ id: string; name: string; teamId?: string | null }>;
};

/** The path parameters and query string a screen was opened with. */
export type ModelProviderRouteReading = {
  params: Readonly<Record<string, string | undefined>>;
  query: Readonly<Record<string, string | undefined>>;
};

/** A short confirmation of something the reader just did. */
export type ModelProviderSuccessNotice = {
  title: string;
  description?: string;
  id?: string;
};

/**
 * A failure, as a screen knows it.
 *
 * The raw `error` travels and never a sentence the screen composed: the wire
 * message of a handled error is its code slug, so a screen that wrote its own
 * copy would print the slug at the customer. `fallbackTitle` names the action
 * that failed, so an unrecognised code still says what the reader was doing.
 */
export type ModelProviderFailureNotice = {
  error: unknown;
  fallbackTitle: string;
  id?: string;
};

/**
 * A `platform/app` drawer these screens open by address rather than by mounting.
 *
 * All three are registered in `platform/app/src/components/drawerRegistry.ts`
 * and two of them have openers outside this family, so none of them may be
 * deleted by this move and none may be copied into this package — a registry is
 * composition, and a screen only ever needed the address.
 */
export type ModelProviderPlatformDrawer =
  | "editModelProvider"
  | "defaultModelOverride"
  | "llmModelCost";

/** The one thing the screens are handed. */
export abstract class ModelProviderHostApi {
  /** The organization, team and project these pages are about. */
  abstract scope(): ModelProviderHostScope;

  /** Whether the reader holds a grant, answered synchronously and fail-closed. */
  abstract hasPermission(permission: string): boolean;

  /** Every scope the reader can see: the filter's options and the chips' names. */
  abstract availableScopes(): ModelProviderAvailableScopes;

  abstract route(): ModelProviderRouteReading;

  /** The whole next query string, so a screen can remove a key as well as set one. */
  abstract setQuery(
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ): void;

  abstract succeeded(notice: ModelProviderSuccessNotice): void;

  abstract failed(failure: ModelProviderFailureNotice): void;

  /**
   * Whether the application already showed this failure to the reader (so it isn't toasted
   * twice). Recorded gap, answered `false`: the backing `WeakSet` lives on `platform/app`'s
   * MutationCache, which the `apps/ui` client build doesn't wrap — same gap the datasets
   * family recorded for `isReportedGlobally`.
   */
  abstract isReportedGlobally(error: unknown): boolean;

  /**
   * Puts a `platform/app` drawer's address in the URL. `params` use the drawer's own
   * (unprefixed) names; the host writes the `drawer.*` query keys, as `openDrawer` does. Known
   * gap shared with the agents, me, automations and gateway families: nothing mounts the
   * registry above an `apps/ui`-served screen yet, so the address is right but the drawer
   * doesn't open.
   */
  abstract openPlatformDrawer(request: {
    drawer: ModelProviderPlatformDrawer;
    params?: Readonly<Record<string, string | undefined>>;
  }): void;
}

const ModelProviderHostContext = createContext<ModelProviderHostApi | undefined>(void 0);

/** Publishes the host to the screens and everything they render. */
export const ModelProviderHostProvider = ModelProviderHostContext.Provider;

/**
 * The host these screens are mounted in.
 *
 * Missing means a screen was rendered outside the frontend feature that owns
 * it, which is a composition fault rather than something a screen can degrade
 * around.
 */
export function useModelProviderHost(): ModelProviderHostApi {
  const host = useContext(ModelProviderHostContext);
  if (!host) {
    throw new Error(
      "No Model Provider host is mounted above this screen; render it inside the model-provider frontend feature.",
    );
  }
  return host;
}
