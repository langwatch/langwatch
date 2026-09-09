/**
 * What the Datasets screens ask of the application they are mounted in.
 *
 * A screen may not import `@langwatch/ui`, the router, a toast singleton or the
 * session client: those are the imports ADR-004 seals off from a feature-web
 * package, and reaching for any of them is also what would make these screens
 * untestable outside a running application. They ask this port instead, and the
 * frontend feature that owns them — `apps/ui/src/features/dataset` — answers it
 * by adapting the browser capabilities the application already resolves.
 *
 * It lives in `model` because it is a package-wide portable value: types plus
 * the React context they travel in, depending on nothing but React.
 *
 * THE SIXTH FAMILY TO DECLARE THIS SHAPE, after `GovernanceHostPort`,
 * `GatewayHostPort`, `PersonalWorkspaceHostPort`, `AutomationHostPort`,
 * `OpsHostPort` and `AgentManagementHostPort`. Each of those recorded that a
 * repeat is the signal to promote the shape into one place, and each left it,
 * for the same reason: promotion changes packages a page-family move does not
 * own, and doing it inside one would hide it. Recorded again in
 * `dev/docs/plans/ui-family-move-manifests.md`.
 *
 * TWO THINGS THIS FAMILY ASKS THAT THE OTHERS DID NOT:
 *
 * - `isLiteMember()`. The lite `EXTERNAL` membership role is not a permission —
 *   it is a column on the reader's organization membership — so it cannot come
 *   off `hasPermission`, and `apps/ui` already reads it once for the settings
 *   menu (`behavior/ui-organization-facts.ts`). The list page hides Edit and
 *   Delete behind it, which is the scenario
 *   `specs/rbac/lite-member-restrictions.feature` binds.
 * - `copyTargets()`. Replicating a dataset offers every project the reader may
 *   create a dataset in, which is a per-TEAM answer rather than a per-scope one,
 *   so the page-level `hasPermission` is the wrong question. The application
 *   computes the list; the dialog only renders it.
 */

import { createContext, useContext } from "react";

/** The project every dataset on these pages belongs to. */
export type DatasetHostProject = {
  id: string;
  slug: string;
  name?: string;
};

/** One project a dataset can be replicated into. */
export type DatasetCopyTarget = {
  label: string;
  value: string;
};

/** The path parameters and query string a screen was opened with. */
export type DatasetRouteReading = {
  params: Readonly<Record<string, string | undefined>>;
  query: Readonly<Record<string, string | undefined>>;
};

/** A short confirmation of something the reader just did. */
export type DatasetSuccessNotice = {
  title: string;
  description?: string;
  id?: string;
  /** How long the notice stands, in milliseconds. */
  durationMs?: number;
  /** An offer to undo what just happened, rendered inside the notice. */
  undo?: { label: string; perform: () => void };
};

/**
 * A failure, as a screen knows it.
 *
 * The raw `error` travels and never a sentence the screen composed: since the
 * wire message of a handled error is its code slug, a screen that wrote its own
 * copy would print the slug at the customer. `fallbackTitle` names the action
 * that failed, so an unrecognised code still says what the reader was doing.
 */
export type DatasetFailureNotice = {
  error: unknown;
  fallbackTitle: string;
  id?: string;
};

/**
 * The one thing the screens are handed.
 *
 * Methods rather than an object of loose functions, so the adapter is a class
 * the frontend feature constructs once and a test double is an obvious object
 * literal.
 */
export abstract class DatasetHostPort {
  /** The project the address is about. Datasets are project-scoped. */
  abstract project(): DatasetHostProject | undefined;

  /** A grant, for the scope this page is about. */
  abstract hasPermission(permission: string): boolean;

  /** The lite `EXTERNAL` membership role, which reads but never writes. */
  abstract isLiteMember(): boolean;

  /** Where a dataset may be replicated to. Empty while the graph is loading. */
  abstract copyTargets(): readonly DatasetCopyTarget[];

  abstract route(): DatasetRouteReading;

  /** The whole next query string, so a screen can remove a key as well as set one. */
  abstract setQuery(
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ): void;

  abstract navigate(to: string): void;

  abstract succeeded(notice: DatasetSuccessNotice): void;

  abstract failed(failure: DatasetFailureNotice): void;

  /**
   * Whether the application has already told the reader about this failure.
   *
   * `platform/app` routes some tRPC errors through one global handler that puts
   * up its own dialog — the lite-member restriction is the case that matters
   * here — and a screen that toasts as well says the same thing twice.
   */
  abstract isReportedGlobally(error: unknown): boolean;
}

const DatasetHostContext = createContext<DatasetHostPort | undefined>(void 0);

/** Publishes the host to the screens and everything they render. */
export const DatasetHostProvider = DatasetHostContext.Provider;

/**
 * The host these screens are mounted in.
 *
 * Missing means a screen was rendered outside the frontend feature that owns
 * it, which is a composition fault rather than something a screen can degrade
 * around.
 */
export function useDatasetHost(): DatasetHostPort {
  const host = useContext(DatasetHostContext);
  if (!host) {
    throw new Error(
      "No Datasets host is mounted above this screen; render it inside the dataset frontend feature.",
    );
  }
  return host;
}
