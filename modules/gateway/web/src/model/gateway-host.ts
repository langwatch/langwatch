/** What the AI Gateway screens ask of the application they are mounted in. */

import { createContext, useContext } from "react";

/** The organization and project the current page is about. */
export type GatewayScope = {
  organizationId: string | null;
  projectId: string | null;
};

/** One organization as the section reads it: its own row plus its teams. */
export type GatewayOrganization = {
  id: string;
  name: string;
  slug: string;
  teams: readonly GatewayTeam[];
};

export type GatewayTeam = {
  id: string;
  name: string;
  projects: readonly GatewayProject[];
};

export type GatewayProject = {
  id: string;
  name: string;
  slug: string;
  teamId: string;
};

/** Who is signed in, as a key's ownership needs to know them. */
export type GatewayActor = {
  id: string;
  name: string | null;
  email: string | null;
};

/** The path parameters and query string the screen was opened with. */
export type GatewayRouteReading = {
  params: Readonly<Record<string, string | undefined>>;
  query: Readonly<Record<string, string | undefined>>;
};

/** A short confirmation of something the reader just did. */
export type GatewaySuccessNotice = {
  title: string;
  description?: string;
  id?: string;
};

/**
 * A failure, as the screen knows it. The raw `error` travels, never a
 * screen-composed sentence — its wire message is a code slug. `fallbackTitle`
 * names the action, so an unrecognised code still says what was happening.
 */
export type GatewayFailureNotice = {
  error: unknown;
  fallbackTitle: string;
  id?: string;
};

/**
 * The shape of the deployment, as the usage snippet and install copy read it.
 * `gatewayBaseUrl` is the address a customer's SDK points at, not this
 * application's — its own field rather than derived from `appBaseUrl`.
 */
export type GatewayDeployment = {
  isSaas: boolean;
  appBaseUrl: string;
  gatewayBaseUrl: string;
};

/**
 * Which plan the organization is on, for surfaces gated on it.
 * `webhookEndpointsEnabled` rather than the whole plan object: a port that
 * handed over the licence row would invite every screen to ask its own question.
 */
export type GatewayPlan = {
  isEnterprise: boolean;
  webhookEndpointsEnabled: boolean;
  isLoading: boolean;
};

/** The port interface a screen is handed. */
/** A drawer a screen can open via the host. */
export type GatewayDrawer = "routingPolicy";

export abstract class GatewayHostApi {
  /** The organization and project this page is about. */
  abstract scope(): GatewayScope;

  /** Every organization the reader can reach, for the pages that name teams. */
  abstract organizations(): readonly GatewayOrganization[];

  /** The organization the section is scoped to, resolved from the scope. */
  abstract organization(): GatewayOrganization | undefined;

  /** The project the reader is standing in, when there is one. */
  abstract project(): GatewayProject | undefined;

  /** The team that project belongs to, when there is one. */
  abstract team(): GatewayTeam | undefined;

  /** Who is signed in. Null while the session is still arriving. */
  abstract currentUser(): GatewayActor | null;

  /** Fails closed: an answer that has not arrived reads as no. */
  abstract hasPermission(permission: string): boolean;

  /** Fails closed the same way. */
  abstract isFeatureEnabled(flag: string): boolean;

  abstract plan(): GatewayPlan;

  /** What kind of deployment this is, and where its gateway answers. */
  abstract deployment(): GatewayDeployment;

  abstract route(): GatewayRouteReading;

  /** Replaces the whole query string; a key left out is a key removed. */
  abstract setQuery(
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ): void;

  abstract navigate(to: string): void;

  /**
   * Puts a registered drawer's address in the URL; params are the drawer's own
   * parameter names, unprefixed.
   */
  abstract openDrawer(request: {
    drawer: GatewayDrawer;
    params?: Readonly<Record<string, string | undefined>>;
  }): void;

  abstract succeeded(notice: GatewaySuccessNotice): void;

  abstract failed(failure: GatewayFailureNotice): void;
}

const GatewayHostContext = createContext<GatewayHostApi | undefined>(void 0);

/** Publishes the host to every gateway screen below it. */
export const GatewayHostProvider = GatewayHostContext.Provider;

/**
 * The application this screen is running in. Missing means the screen was
 * mounted outside its frontend feature — a composition fault, not something
 * the screen can degrade around.
 */
export function useGatewayHost(): GatewayHostApi {
  const host = useContext(GatewayHostContext);
  if (!host) {
    throw new Error(
      "No gateway host is mounted above this screen; render it inside the gateway frontend feature.",
    );
  }
  return host;
}
