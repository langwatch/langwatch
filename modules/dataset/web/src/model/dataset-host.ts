/** Datasets screens port (sealed from UI/router/toast). Special asks:
 * isLiteMember() and copyTargets() (team-level, not scope-level).
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
 * A failure, as a screen knows it. The raw `error` travels, never a
 * screen-composed sentence — a handled error's wire message IS its code
 * slug. `fallbackTitle` names the failing action for an unrecognised code.
 */
export type DatasetFailureNotice = {
  error: unknown;
  fallbackTitle: string;
  id?: string;
};

/**
 * The one thing the screens are handed. Methods rather than loose
 * functions, so the adapter is a class the frontend constructs once, and a
 * test double is an obvious object literal.
 */
export abstract class DatasetHostApi {
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
   * Whether the app already told the reader about this failure — some tRPC
   * errors (the lite-member restriction matters here) route through one
   * global handler with its own dialog, and a screen that toasts too repeats it.
   */
  abstract isReportedGlobally(error: unknown): boolean;
}

const DatasetHostContext = createContext<DatasetHostApi | undefined>(void 0);

/** Publishes the host to the screens and everything they render. */
export const DatasetHostProvider = DatasetHostContext.Provider;

/**
 * The host these screens are mounted in. Missing means a screen rendered
 * outside the frontend feature that owns it — a composition fault, not
 * something a screen can degrade around.
 */
export function useDatasetHost(): DatasetHostApi {
  const host = useContext(DatasetHostContext);
  if (!host) {
    throw new Error(
      "No Datasets host is mounted above this screen; render it inside the dataset frontend feature.",
    );
  }
  return host;
}
