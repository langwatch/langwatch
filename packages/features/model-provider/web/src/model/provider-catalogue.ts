/**
 * The two derivations the providers table makes from data it is handed: which
 * providers can still be added, and what order the configured rows read in.
 *
 * Pure, and out of the screen, because both are rules rather than markup —
 * "a deprecated provider accepts no new rows" and "an organization row sits
 * above a team row" are the kind of statement a test should be able to make
 * without a DOM.
 */

import {
  modelProviders as modelProvidersRegistry,
  providerDeprecation,
} from "@langwatch/model-provider-contract";
import { broadestScopeRank } from "./scope-breadth";
import type { ModelProviderAvailableScopes } from "./model-provider-host";

/** A provider type the add menu offers, in the order it offers them. */
export type AddableProvider = {
  provider: string;
  name: string;
  /**
   * Sign-in providers (Codex) are a niche, subscription-billed harness rather
   * than a general API-key provider, so they sort to the bottom of this menu.
   * On Langy / onboarding the surface-aware grid promotes them to the top
   * instead (see `providersForSurface`).
   */
  authFlow: "api-key" | "oauth-device" | undefined;
};

/**
 * Every registry provider is always addable — a project may hold "OpenAI" at
 * organization scope plus another "OpenAI" at project scope, and hiding the
 * already-configured ones prevented the very multi-instance flow the scope
 * picker exists to support.
 *
 * Deprecated providers are the one exclusion: the server refuses to create one,
 * so offering it would be a menu entry that leads to a refusal. Stored rows for
 * a deprecated provider still render in the table.
 */
export function addableProviders(): AddableProvider[] {
  return Object.keys(modelProvidersRegistry)
    .filter((providerKey) => !providerDeprecation(providerKey))
    .map((providerKey) => {
      const entry = modelProvidersRegistry[providerKey as keyof typeof modelProvidersRegistry];
      return {
        provider: providerKey,
        name: entry?.name ?? providerKey,
        // The registry keeps literal entry types via `satisfies`, so widen to
        // read the optional auth flow — the same shape `ModelProviderForm`'s
        // `isOAuthDeviceProvider` reads it through.
        authFlow: (entry as { authFlow?: "api-key" | "oauth-device" } | undefined)?.authFlow,
      };
    })
    .sort((a, b) => {
      const aDevice = a.authFlow === "oauth-device" ? 1 : 0;
      const bDevice = b.authFlow === "oauth-device" ? 1 : 0;
      return aDevice - bDevice;
    });
}

/** A configured provider row, as narrow as the ordering below needs it. */
type OrderableProviderRow = {
  name: string;
  scopes?: Array<{ scopeType: string }>;
  scopeType?: string;
};

/**
 * Configured rows, broadest scope first and by name within a scope — the same
 * order the virtual-key provider picker uses.
 *
 * The label is the row's OWN name, which the list procedure carries: a
 * multi-instance setup has "OpenAI" and "OpenAI2" and they must not sort or
 * read alike. Every row has one — the column is NOT NULL and the env-fed
 * pseudo-rows take the registry's name — so there is nothing to fall back to.
 */
export function sortProvidersForTable<T extends OrderableProviderRow>(rows: readonly T[]): T[] {
  const scopeTypesOf = (row: T): string[] => {
    if (row.scopes && row.scopes.length > 0) return row.scopes.map((scope) => scope.scopeType);
    return row.scopeType ? [row.scopeType] : [];
  };
  return [...rows].sort(
    (a, b) =>
      broadestScopeRank(scopeTypesOf(a)) - broadestScopeRank(scopeTypesOf(b)) ||
      a.name.localeCompare(b.name),
  );
}

/**
 * Scope id to the name it should read as.
 *
 * Without this lookup, a provider bound to two teams renders as two identical
 * "Team" pills. `platform/app` walked the organization graph for it; the host
 * hands over the same three lists the scope filter offers, so one read answers
 * both.
 */
export function scopeNamesOf(available: ModelProviderAvailableScopes): Map<string, string> {
  const names = new Map<string, string>();
  if (available.organization) names.set(available.organization.id, available.organization.name);
  for (const team of available.teams) names.set(team.id, team.name);
  for (const project of available.projects) names.set(project.id, project.name);
  return names;
}
