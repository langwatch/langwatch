/**
 * What the project home asks of the application it is mounted in.
 *
 * THE PAGE IS A COMPOSITION, and that is what shapes this port. Everything the
 * home draws that belongs to another FAMILY it reaches through that family's
 * published entry — the search palette and the feature icons from
 * `@langwatch/navigation-web/command-bar`, the assistant from `@langwatch/langy-web`,
 * the traces chart and the period selector from `@langwatch/analytics-web`.
 * What it reaches through THIS port is everything that used to be
 * `platform/app`'s and is nobody's feature: who is reading, which project and
 * organization they are in, what they may do, which rollouts are on for them,
 * what kind of deployment this is, and the two navigations.
 *
 * SYNCHRONOUS AND FAIL-CLOSED, the contract every other host port in this
 * family keeps: a grant or a flag that has not answered yet reads as "not yet",
 * never as "yes". The three gates that pick which of the three home
 * compositions renders carry their own `isResolving`, because the page commits
 * to nothing while one of them is in the air — a home that paints the classic
 * lobby and swaps it a beat later reads as a bug in the product.
 */

import { createContext, useContext } from "react";

/** The project the home is about. */
export type ProjectHomeProject = {
  id: string;
  name: string;
  slug: string;
  /**
   * Whether a trace has ever arrived.
   *
   * The project row is authoritative for "has this project ever been used":
   * the collector flips it on the first trace, while the integration-checks
   * read of the same fact can lag its cache or never come at all, since it is
   * permission-gated. Leading a traced project with "send your first trace" is
   * the failure this field exists to prevent.
   */
  firstMessage?: boolean | null;
  /**
   * The project's own ingestion key, when the application will hand one over.
   *
   * ONE READER: the "copy a prompt for your coding agent" control, which puts
   * a runnable setup in the reader's clipboard — a prompt without the key stops
   * to ask for credentials, which is a worse first run but not a broken one. So
   * it is optional rather than required, and a host that redacts the base key
   * (`organization.base-key-redaction`) answers without it and the prompt says
   * where to find one instead.
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
 * Whether this reader has the assistant at all, with the wait exposed.
 *
 * Three layers behind one answer — membership, the `langy:view` grant and the
 * rollout — resolved by the application because all three are its readings.
 * `isResolving` is separate from `show` for the reason the composition rule
 * gives: "no" and "not yet" are different answers, and one of them must not
 * pick a page.
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
   * Where this deployment receives traces.
   *
   * Read once, to decide whether a copied setup has to name an endpoint at
   * all: only a self-hosted deployment does, and emitting an empty one breaks
   * the SDK silently.
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
   * Whether the workspace itself is still arriving.
   *
   * The composition gates read it: a reader with no project yet is WAITING,
   * not decided, and a page that resolved against half a workspace would pick
   * the wrong home and then change shape.
   */
  abstract isLoading(): boolean;

  abstract hasPermission(permission: string): boolean;

  /** One rollout flag, resolved for this project and organization. */
  abstract featureFlag(flag: string): ProjectHomeFlagReading;

  /** Whether the reader has the assistant, and whether that is settled. */
  abstract langyVisibility(): ProjectHomeLangyVisibility;

  /**
   * Whether the reader may START a turn with the assistant.
   *
   * `langy:view` is the read grant; this is `langy:create`. Every control on
   * this page that puts a composer or a borrowable ask in front of somebody
   * asks THIS one, because sending on the read grant comes back 403.
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
