/**
 * What the Model Providers and Model Costs screens ask of the host, per
 * ADR-004's package boundary. `openPlatformDrawer` exists because three
 * overlay drawers have outside callers: a screen names the drawer, the host writes its address.
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
 * The organization, teams and projects the reader can see — used by the scope
 * filter and by a provider row's chips. Declared structurally rather than
 * importing `AvailableScopes`, to avoid a second `ui-screen-closure` finding.
 */
export type ModelProviderAvailableScopes = {
  organization: { id: string; name: string } | null;
  teams: { id: string; name: string }[];
  projects: { id: string; name: string; teamId?: string | null }[];
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
 * A failure, as a screen knows it. The raw `error` travels rather than a
 * screen-composed sentence, since a handled error's wire message is its
 * code slug; `fallbackTitle` names the action that failed instead.
 */
export type ModelProviderFailureNotice = {
  error: unknown;
  fallbackTitle: string;
  id?: string;
};

/**
 * A `platform/app` drawer, opened by address rather than mounting.
 * Registered in `platform/app/src/components/drawerRegistry.ts`; two of
 * three have outside openers, so none may move or be copied here.
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
   * Whether the app already showed this failure (so it isn't toasted twice).
   * Recorded gap, answered `false`: the `WeakSet` lives on `platform/app`'s
   * MutationCache, which `apps/ui`'s build doesn't wrap (same gap datasets recorded).
   */
  abstract isReportedGlobally(error: unknown): boolean;

  /**
   * Puts a `platform/app` drawer's address in the URL, using the drawer's own
   * unprefixed `params` names; known gap shared with agents, me, automations
   * and gateway: nothing mounts the registry above an `apps/ui` screen yet.
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
 * The host these screens are mounted in. Missing means a screen was rendered
 * outside the frontend feature that owns it — a composition fault, not
 * something a screen can degrade around.
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

/** The grant that decides whether this page can be written to at all. */
export const MODEL_PROVIDER_MANAGE_PERMISSION = "project:manage";

/** The query parameter the page-level scope filter lives in. */
export const MODEL_PROVIDER_SCOPE_QUERY_KEY = "scope";

/** The grant that decides whether cost rules can be written from this page. */
export const MODEL_COST_MANAGE_PERMISSION = "project:manage";
