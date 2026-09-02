/**
 * What the Model Providers and Model Costs screens ask of the application they
 * are mounted in.
 *
 * A screen may not import `@langwatch/ui`, the router, a toast singleton or the
 * session client: those are the imports ADR-004 seals off from a feature-web
 * package, and reaching for any of them is also what would make these screens
 * untestable outside a running application. They ask this port instead, and the
 * frontend feature that owns it — `apps/ui/src/features/model-provider` —
 * answers it by adapting the browser capabilities the application resolves.
 *
 * THE EIGHTH FAMILY TO DECLARE THIS SHAPE, after governance, gateway, the
 * personal workspace, automations, ops, agents, data governance and datasets.
 * Every one of those recorded that a repeat is the signal to promote it into
 * one place, and every one left it, for the same reason: promotion changes
 * packages a page-family move does not own. Recorded again in
 * `dev/docs/plans/ui-family-move-manifests.md`.
 *
 * WHAT THIS FAMILY ASKS THAT THE OTHERS DID NOT is `openPlatformDrawer`. Three
 * of the overlays these pages reach are registered drawers in `platform/app`
 * with callers outside this family — the provider editor is opened by the
 * evaluator type selector, and the model-cost editor by the unmapped-cost
 * suggestion in a trace — so this move may not delete them, and a screen may
 * not carry a copy of a drawer registry. The screen NAMES the drawer and the
 * host writes the address, which is the shape the agents family settled.
 */

import { createContext, useContext } from "react";

/** The organization, team and project the address is about. */
export type ModelProviderHostScope = {
  organizationId: string | undefined;
  teamId: string | undefined;
  projectId: string | undefined;
};

/**
 * The organization, teams and projects the reader can SEE.
 *
 * Two surfaces read it: the scope FILTER at the top of the page offers every
 * one of them, and the scope chips on a provider row resolve a scope id to the
 * name it should read as. Both were derived from the organization graph the
 * application shell already holds, which is where `useAvailableScopes` got them
 * in `platform/app`.
 *
 * Declared structurally rather than as `AvailableScopes` from
 * `@langwatch/authz-web`: the two are the same three fields, and naming that
 * package here would put a second `ui-screen-closure` finding on the family for
 * a shape the port can spell out.
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
export abstract class ModelProviderHostPort {
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
   * Whether the application has already shown this failure to the reader.
   *
   * `platform/app`'s model-costs table asked `isHandledByGlobalHandler` before
   * toasting, so a refusal the application already put on screen as a modal was
   * not also toasted. A RECORDED GAP, answered `false`: that answer is a
   * `WeakSet` four interceptors on `platform/app`'s MutationCache write to, and
   * that cache does not wrap the client `apps/ui` builds. Same gap the datasets
   * family recorded for `isReportedGlobally`, and it closes the same way.
   */
  abstract isReportedGlobally(error: unknown): boolean;

  /**
   * Puts a `platform/app` drawer's address in the URL.
   *
   * `params` are the DRAWER'S OWN parameter names, unprefixed — the `drawer.`
   * vocabulary belongs to the host, which writes `?drawer.open=<drawer>` plus
   * one `drawer.<name>` per parameter and clears every stale `drawer.*` key,
   * exactly as `openDrawer` does.
   *
   * KNOWN GAP, shared with the agents, me, automations and gateway families:
   * nothing mounts that registry above a screen served from `apps/ui` until the
   * chrome layout route exists, so the address is right and the drawer does not
   * open yet.
   */
  abstract openPlatformDrawer(request: {
    drawer: ModelProviderPlatformDrawer;
    params?: Readonly<Record<string, string | undefined>>;
  }): void;
}

const ModelProviderHostContext = createContext<ModelProviderHostPort | undefined>(void 0);

/** Publishes the host to the screens and everything they render. */
export const ModelProviderHostProvider = ModelProviderHostContext.Provider;

/**
 * The host these screens are mounted in.
 *
 * Missing means a screen was rendered outside the frontend feature that owns
 * it, which is a composition fault rather than something a screen can degrade
 * around.
 */
export function useModelProviderHost(): ModelProviderHostPort {
  const host = useContext(ModelProviderHostContext);
  if (!host) {
    throw new Error(
      "No Model Provider host is mounted above this screen; render it inside the model-provider frontend feature.",
    );
  }
  return host;
}
