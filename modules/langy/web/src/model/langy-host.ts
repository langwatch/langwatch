/**
 * What the Langy dock asks of the application it is mounted in.
 */

import { createContext, useContext } from "react";

export type LangyHostProject = {
  id: string;
  slug: string;
  name: string;
  firstMessage?: boolean;
  apiKey?: string;
};

export type LangyHostTeam = {
  id: string;
  name?: string;
  slug?: string;
  isPersonal?: boolean;
  ownerUserId?: string | null;
  members?: { userId: string }[];
};

export type LangyHostOrganization = { id: string; name?: string; slug?: string };

export type LangyHostOrganizationRole = string | undefined;

export type LangyHostUser = {
  id: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
};

export type LangyRouteReading = {
  params: Readonly<Record<string, string | string[] | undefined>>;
  query: Readonly<Record<string, string | undefined>>;
  pathname: string;
};

export type LangySuccessNotice = { title: string; description?: string };

export type LangyFailureNotice = {
  error: unknown;
  fallbackTitle: string;
  description?: string;
  id?: string;
};

export abstract class LangyHostPort {
  abstract project(): LangyHostProject | undefined;

  abstract organization(): LangyHostOrganization | undefined;

  abstract team(): LangyHostTeam | undefined;

  abstract organizationRole(): LangyHostOrganizationRole;

  abstract currentUser(): LangyHostUser | undefined;

  abstract hasPermission(permission: string): boolean;

  abstract isLoading(): boolean;

  /**
   * Whether the project in scope is the deployment's shared demo project.
   * A deployment fact (ADR-101), so this package cannot compare it itself —
   * the application reads its own config leaf and answers here.
   */
  abstract isDemoProject(): boolean;

  /** Tri-state: `undefined` while the answer is still arriving. */
  abstract featureFlag(flag: string): boolean | undefined;

  abstract route(): LangyRouteReading;

  /** MERGES into the query, so the dock can set one key without owning the rest. */
  abstract setQuery(
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ): void;

  abstract navigate(to: string, options?: { replace?: boolean }): void;

  /** Where a reader manages the plan. Absent when the deployment has no billing. */
  abstract planManagementUrl(): string | undefined;

  abstract succeeded(notice: LangySuccessNotice): void;

  abstract failed(failure: LangyFailureNotice): void;
}

const LangyHostContext = createContext<LangyHostPort | undefined>(void 0);

export const LangyHostProvider = LangyHostContext.Provider;

export function useLangyHost(): LangyHostPort {
  const host = useContext(LangyHostContext);
  if (!host) {
    throw new Error("The Langy surfaces must be mounted inside a LangyHostProvider.");
  }
  return host;
}

export function useOptionalLangyHost(): LangyHostPort | undefined {
  return useContext(LangyHostContext);
}

/**
 * The three universal scope tiers, as `langyMakeDefaultOffer` reads them.
 */
export const SCOPE_TIERS = ["ORGANIZATION", "TEAM", "PROJECT"] as const;
export type ScopeTier = (typeof SCOPE_TIERS)[number];
