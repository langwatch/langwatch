/**
 * What the project home asks of its mounting application: what used to be
 * `platform/app`'s and is nobody's feature. FAIL-CLOSED: unanswered reads
 * as "not yet", so each gate carries its own `isResolving`.
 */

import { createContext, useContext } from "react";

/** The project the home is about. */
export type ProjectHomeProject = {
  id: string;
  name: string;
  slug: string;
  /**
   * Whether a trace has ever arrived. The project row is authoritative (the
   * collector flips it on first trace); the integration-checks read of the
   * same fact can lag or never arrive, since it's permission-gated.
   */
  firstMessage?: boolean | null;
  /**
   * The project's ingestion key, when the app will hand one over. Optional,
   * not required — a redacting host (`organization.base-key-redaction`)
   * answers without it and the prompt says where to find one instead.
   */
  apiKey?: string | null;
};

/** The organization it sits in. */
export type ProjectHomeOrganization = {
  id: string;
  name: string;
};

/** The signed-in reader, as the greeting needs them. */
export type ProjectHomeUser = {
  id: string;
  name: string | null;
};

/** A rollout answer, tri-state: `isLoading` is what stops the page deciding. */
export type ProjectHomeFlagReading = {
  enabled: boolean;
  isLoading: boolean;
};

/**
 * Whether this reader has the assistant, with the wait exposed. Three
 * layers behind one answer (membership, `langy:view`, rollout); `isResolving`
 * is separate from `show` since "no" and "not yet" must not pick a page.
 */
export type ProjectHomeLangyVisibility = {
  show: boolean;
  isResolving: boolean;
};

/** What kind of deployment the home is drawn on. */
export type ProjectHomeDeployment = {
  isSaaS: boolean;
  isDevelopment: boolean;
  /** The shared demo project, when this deployment configures one. */
  demoProjectSlug?: string;
  /**
   * Where this deployment receives traces. Read once to decide whether a
   * copied setup needs an endpoint at all — an empty one breaks the SDK silently.
   */
  baseHost?: string;
};

export abstract class ProjectHomeHostPort {
  /** The project in scope, or nothing before one resolves. */
  abstract project(): ProjectHomeProject | undefined;

  /** The organization that holds it. */
  abstract organization(): ProjectHomeOrganization | undefined;

  /** The reader the page greets. */
  abstract currentUser(): ProjectHomeUser | undefined;

  /**
   * Whether the workspace itself is still arriving: a reader with no
   * project yet is WAITING, not decided, or the page picks a home then
   * changes shape.
   */
  abstract isLoading(): boolean;

  abstract hasPermission(permission: string): boolean;

  /** One rollout flag, resolved for this project and organization. */
  abstract featureFlag(flag: string): ProjectHomeFlagReading;

  /** Whether the reader has the assistant, and whether that is settled. */
  abstract langyVisibility(): ProjectHomeLangyVisibility;

  /**
   * Whether the reader may START a turn with the assistant (`langy:create`,
   * not the `langy:view` read grant) — sending on the read grant is a 403.
   */
  abstract canAskLangy(): boolean;

  abstract deployment(): ProjectHomeDeployment;

  /** Whether the reader asked their system for less motion. */
  abstract reducedMotion(): boolean;

  /** Sends the reader somewhere else in the application. */
  abstract navigate(to: string): void;
}

const ProjectHomeHostContext = createContext<ProjectHomeHostPort | undefined>(void 0);

export const ProjectHomeHostProvider = ProjectHomeHostContext.Provider;

/** The host the composing application mounted above this screen. */
export function useProjectHomeHost(): ProjectHomeHostPort {
  const host = useContext(ProjectHomeHostContext);
  if (!host) {
    throw new Error("The project home must be mounted inside a ProjectHomeHostProvider.");
  }
  return host;
}
