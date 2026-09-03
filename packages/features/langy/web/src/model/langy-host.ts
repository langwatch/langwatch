/**
 * What the Langy dock asks of the application it is mounted in.
 *
 * ONE PORT FOR THE WHOLE FAMILY, the shape every family since governance has
 * written. Everything the dock used to read off `useOrganizationTeamProject`,
 * `useRouter`, `useRequiredSession` and the toaster arrives through these
 * methods, which is what let twenty-three thousand lines of Langy move with
 * their `api.langy.x.useQuery` call sites unchanged.
 *
 * `featureFlag` is here rather than on a hook of its own because the dock reads
 * three flags and each one is a tri-state: `undefined` means "not answered
 * yet", and a panel that flashed a capability off while the answer arrived
 * would be worse than one that waits.
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
 *
 * `~/server/scopes/scope.types` is the application's server-side contract for
 * the scope picker and carries a Zod schema a browser package has no use for.
 * The tier union is the only half this family reads, and it is stated here so
 * the offer's copy ("make this the default for the whole organization") stays
 * checked. See ADR-021 for why the storage enums stay per table.
 */
export const SCOPE_TIERS = ["ORGANIZATION", "TEAM", "PROJECT"] as const;
export type ScopeTier = (typeof SCOPE_TIERS)[number];
