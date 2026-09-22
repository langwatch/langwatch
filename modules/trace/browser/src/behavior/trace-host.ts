/**
 * What the trace screens ask of the application they are mounted in.
 */

import {
  createUiScopeHost,
  UiScopeHostProvider,
  type UiScopeHost,
} from "@langwatch/browser-host/use-organization-team-project";
import { createContext, createElement, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import type { z } from "zod";

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

/**
 * One thing the agent may do on the screen that is open, with the schema its
 * payload is checked against first.
 */
export type TraceLangyActionHandler = {
  payloadSchema: z.ZodTypeAny;
  run: (payload: never) => unknown;
};

/** Every such action, by the kind the agent dispatches. */
export type TraceLangyActionHandlers = Readonly<Record<string, TraceLangyActionHandler>>;

/**
 * One reference riding along with a question — the Explorer view, the applied
 * search — as the agent reads it.
 */
export type TraceLangyContext = {
  kind: "filter" | "trace";
  /** Self-describing text the agent scopes the answer to. */
  ref: string;
  label: string;
};

/** What the screen hands the agent: a question, or a sentence to finish. */
export type TraceLangyAskRequest = {
  /** Asked outright on a fresh conversation; absent opens the composer. */
  question?: string;
  /** Starts the composer's sentence, never over what the reader wrote. */
  draft?: string;
  /** Attached in this order, after the ask has reset the conversation. */
  context?: readonly TraceLangyContext[];
};

export abstract class TraceHostApi {
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

  /**
   * Publishes what the agent may do on the open screen and hands back the way
   * to withdraw it. An application with no agent answers with a no-op, which
   * is why a screen never reaches the agent's browser half itself.
   */
  abstract registerLangyActions(handlers: TraceLangyActionHandlers): () => void;

  /**
   * Hands a question, and the view it is asked about, to the agent. An
   * application with no agent does nothing with it — which is why a screen
   * never reaches the agent's browser half itself.
   */
  abstract askLangy(request: TraceLangyAskRequest): void;
}

const TraceHostContext = createContext<TraceHostApi | undefined>(void 0);

/**
 * Publishes the host, and the CANONICAL SCOPE READING alongside it.
 */
export function TraceHostProvider({
  value,
  children,
}: {
  value: TraceHostApi | undefined;
  children: ReactNode;
}) {
  const scope = useMemo<UiScopeHost | undefined>(
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
export function useTraceHost(): TraceHostApi {
  const host = useContext(TraceHostContext);
  if (!host) {
    throw new Error("The trace screens must be mounted inside a TraceHostProvider.");
  }
  return host;
}

/** The host, where a surface may legitimately render without one (the shared page). */
export function useOptionalTraceHost(): TraceHostApi | undefined {
  return useContext(TraceHostContext);
}
