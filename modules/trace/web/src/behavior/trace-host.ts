/**
 * What the trace screens ask of the application they are mounted in.
 */

import { createContext, createElement, useContext, useMemo } from "react";
import type { ReactNode } from "react";

import {
  createUiScopeHost,
  UiScopeHostProvider,
  type UiScopeHostPort,
} from "@langwatch/ui-host/use-organization-team-project";

/** The project every trace read is scoped to. */
export type TraceHostProject = {
  id: string;
  slug: string;
  name: string;
  /** Whether anything has ever been ingested — the empty state leads on it. */
  firstMessage?: boolean;
  /** The ingestion key the Integrate pane prints. */
  apiKey?: string;
  /**
   * Whether live cursors and presence dots are on for this project.
   */
  presenceEnabled?: boolean;
};

/**
 * The team the project belongs to, and the two facts that decide a personal workspace.
 */
export type TraceHostTeam = {
  id: string;
  name?: string;
  slug?: string;
  isPersonal?: boolean;
  ownerUserId?: string | null;
  members?: { userId: string }[];
};

/** The organization the project sits in, for reads scoped above a project. */
export type TraceHostOrganization = {
  id: string;
  name?: string;
  slug?: string;
  /** The organization-wide kill switch for presence. Tri-state, as above. */
  presenceEnabled?: boolean;
};

/** The reader's standing in the organization, for the gates that read it. */
export type TraceHostOrganizationRole = "ADMIN" | "MEMBER" | "EXTERNAL" | undefined;

/** The reader, as an annotation or a presence cursor knows them. */
export type TraceHostUser = {
  id: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
};

/** The path parameters, the pathname and the query string a screen was opened with. */
export type TraceRouteReading = {
  /** The `:id` style segments the matched route captured. */
  params: Readonly<Record<string, string | undefined>>;
  /** The query string, single-valued — the last write of a repeated key wins. */
  query: Readonly<Record<string, string | undefined>>;
  /** The address the reader is on, route-pattern shaped (`/[project]/traces`). */
  pathname: string;
};

/** A short confirmation of something the reader just did. */
export type TraceSuccessNotice = {
  title: string;
  description?: string;
  id?: string;
};

/**
 * A failure, as a screen knows it.
 */
export type TraceFailureAction = {
  label: string;
  run: () => void;
};

export type TraceFailureNotice = {
  error: unknown;
  fallbackTitle: string;
  /**
   * A sentence for a refusal the SCREEN can say more about than the registry.
   */
  description?: string;
  /** The single fix this failure offers, rendered as a button on the notice. */
  action?: TraceFailureAction;
  id?: string;
};

export abstract class TraceHostPort {
  /** The project in scope, or undefined before one resolves. */
  abstract project(): TraceHostProject | undefined;

  /** The organization the project sits in. */
  abstract organization(): TraceHostOrganization | undefined;

  /** The team the project belongs to. */
  abstract team(): TraceHostTeam | undefined;

  /** What the reader is in the organization. */
  abstract organizationRole(): TraceHostOrganizationRole;

  /** The signed-in reader, or undefined on the shared-trace page. */
  abstract currentUser(): TraceHostUser | undefined;

  abstract hasPermission(permission: string): boolean;

  /** Whether the scope answer is still arriving. */
  abstract isLoading(): boolean;

  abstract route(): TraceRouteReading;

  /** MERGES into the query, so a screen can set one key without owning the rest. */
  abstract setQuery(
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ): void;

  /** Sends the reader somewhere else in the application. */
  abstract navigate(to: string, options?: { replace?: boolean }): void;

  abstract succeeded(notice: TraceSuccessNotice): void;

  abstract failed(failure: TraceFailureNotice): void;
}

const TraceHostContext = createContext<TraceHostPort | undefined>(void 0);

/**
 * Publishes the host, and the CANONICAL SCOPE READING alongside it.
 */
export function TraceHostProvider({
  value,
  children,
}: {
  value: TraceHostPort | undefined;
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
    TraceHostContext.Provider,
    { value },
    createElement(UiScopeHostProvider, { value: scope }, children),
  );
}

/** The host the composing application mounted above this screen. */
export function useTraceHost(): TraceHostPort {
  const host = useContext(TraceHostContext);
  if (!host) {
    throw new Error("The trace screens must be mounted inside a TraceHostProvider.");
  }
  return host;
}

/** The host, where a surface may legitimately render without one (the shared page). */
export function useOptionalTraceHost(): TraceHostPort | undefined {
  return useContext(TraceHostContext);
}
