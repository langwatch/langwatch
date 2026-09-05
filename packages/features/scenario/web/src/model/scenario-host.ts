/**
 * What the simulations, scenario-library and Agent Testing screens ask of the
 * application they are mounted in.
 */

import { createContext, createElement, useContext, useMemo } from "react";
import type { ReactNode } from "react";

import {
  createUiScopeHost,
  UiScopeHostProvider,
  type UiScopeHostPort,
} from "@langwatch/ui-host/use-organization-team-project";

/** The project every scenario read is scoped to. */
export type ScenarioHostProject = {
  id: string;
  slug: string;
  name: string;
  /** Whether anything has ever been ingested — the empty states lead on it. */
  firstMessage?: boolean;
  /** The ingestion key the "connect your agent" pane prints. */
  apiKey?: string;
};

/** The team the project belongs to, and the two facts that decide a personal workspace. */
export type ScenarioHostTeam = {
  id: string;
  name?: string;
  slug?: string;
  isPersonal?: boolean;
  ownerUserId?: string | null;
  members?: { userId: string }[];
};

export type ScenarioHostOrganization = {
  id: string;
  name?: string;
  slug?: string;
};

export type ScenarioHostOrganizationRole = string | undefined;

export type ScenarioHostUser = {
  id: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
};

/** The address, as a screen reads it. */
export type ScenarioRouteReading = {
  /** Path parameters, the splat included. */
  params: Readonly<Record<string, string | string[] | undefined>>;
  /** The query string, flat. */
  query: Readonly<Record<string, string | undefined>>;
  /** The path alone. */
  pathname: string;
};

export type ScenarioSuccessNotice = { title: string; description?: string };

/**
 * The one way out a failure offers.
 */
export type ScenarioFailureAction = {
  label: string;
  run: () => void;
};

export type ScenarioFailureNotice = {
  /** The raw failure. The application resolves the words from its own registry. */
  error: unknown;
  /** What the reader was trying to do, for a code the registry does not list. */
  fallbackTitle: string;
  /** A sentence the caller already had, where it knows better than the registry. */
  description?: string;
  /** The single fix this failure offers, rendered as a button on the notice. */
  action?: ScenarioFailureAction;
  /** A dedupe id, so a retried failure replaces its own notice rather than stacking. */
  id?: string;
};

/**
 * The questions this family asks its host.
 */
export abstract class ScenarioHostPort {
  abstract project(): ScenarioHostProject | undefined;

  abstract organization(): ScenarioHostOrganization | undefined;

  abstract team(): ScenarioHostTeam | undefined;

  abstract organizationRole(): ScenarioHostOrganizationRole;

  abstract currentUser(): ScenarioHostUser | undefined;

  abstract hasPermission(permission: string): boolean;

  /** Whether the scope answer is still arriving. */
  abstract isLoading(): boolean;

  abstract route(): ScenarioRouteReading;

  /** MERGES into the query, so a screen can set one key without owning the rest. */
  abstract setQuery(
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ): void;

  abstract navigate(to: string, options?: { replace?: boolean }): void;

  abstract succeeded(notice: ScenarioSuccessNotice): void;

  abstract failed(failure: ScenarioFailureNotice): void;
}

const ScenarioHostContext = createContext<ScenarioHostPort | undefined>(void 0);

/**
 * Publishes the host, and the CANONICAL SCOPE READING alongside it.
 */
export function ScenarioHostProvider({
  value,
  children,
}: {
  value: ScenarioHostPort | undefined;
  children: ReactNode;
}) {
  const scope = useMemo<UiScopeHostPort | undefined>(
    () =>
      value
        ? createUiScopeHost({
            project: () => value.project(),
            organization: () => value.organization(),
            team: () => value.team(),
            organizationRole: () => value.organizationRole(),
            hasPermission: (permission) => value.hasPermission(permission),
            isLoading: () => value.isLoading(),
          })
        : void 0,
    [value],
  );
  return createElement(
    ScenarioHostContext.Provider,
    { value },
    createElement(UiScopeHostProvider, { value: scope }, children),
  );
}

/** The host the composing application mounted above this screen. */
export function useScenarioHost(): ScenarioHostPort {
  const host = useContext(ScenarioHostContext);
  if (!host) {
    throw new Error("The scenario screens must be mounted inside a ScenarioHostProvider.");
  }
  return host;
}

/** The host, where a surface may legitimately render without one. */
export function useOptionalScenarioHost(): ScenarioHostPort | undefined {
  return useContext(ScenarioHostContext);
}
