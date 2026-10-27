/**
 * The two derivations the providers table makes from data it is handed: which providers can
 * still be added, and what order the configured rows read in. Kept pure so both are testable
 * without a DOM.
 */

import {
  modelProviders as modelProvidersRegistry,
  findProviderDeprecation,
} from "@langwatch/model-provider-contract";

import type { ModelProviderAvailableScopes } from "./model-provider-host.ts";
import { broadestScopeRank } from "./scope-breadth.ts";

/** A provider type the add menu offers, in the order it offers them. */
export type AddableProvider = {
  provider: string;
  name: string;
  /**
   * Sign-in providers (Codex) are niche and subscription-billed, so they
   * sort to the bottom of this menu. Langy/onboarding's surface-aware grid
   * promotes them to the top instead (see `providersForSurface`).
   */
  authFlow: "api-key" | "oauth-device" | undefined;
};

/**
 * Every registry provider is always addable, so multi-instance setups (an "OpenAI" at org scope
 * plus another at project scope) stay possible. Deprecated providers are excluded since the
 * server refuses to create them; their stored rows still render in the table.
 */
export function addableProviders(): AddableProvider[] {
  return Object.keys(modelProvidersRegistry)
    .filter((providerKey) => !findProviderDeprecation(providerKey)[0])
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
    .toSorted((a, b) => {
      const aDevice = a.authFlow === "oauth-device" ? 1 : 0;
      const bDevice = b.authFlow === "oauth-device" ? 1 : 0;
      return aDevice - bDevice;
    });
}

/** A configured provider row, as narrow as the ordering below needs it. */
type OrderableProviderRow = {
  name: string;
  scopes?: { scopeType: string }[];
  scopeType?: string;
};

/**
 * Configured rows, broadest scope first and by name within a scope — the same order the
 * virtual-key provider picker uses. Sorts by the row's own name (not the registry's), since a
 * multi-instance setup has "OpenAI" and "OpenAI2" that must not read alike.
 */
export function sortProvidersForTable<T extends OrderableProviderRow>(rows: readonly T[]): T[] {
  const scopeTypesOf = (row: T): string[] => {
    if (row.scopes && row.scopes.length > 0) return row.scopes.map((scope) => scope.scopeType);
    return row.scopeType ? [row.scopeType] : [];
  };
  return [...rows].toSorted(
    (a, b) =>
      broadestScopeRank(scopeTypesOf(a)) - broadestScopeRank(scopeTypesOf(b)) ||
      a.name.localeCompare(b.name),
  );
}

/**
 * Scope id to the name it should read as. Without this, a provider bound
 * to two teams renders as two identical "Team" pills. The host hands over
 * the same three lists the scope filter offers, so one read answers both.
 */
export function scopeNamesOf(available: ModelProviderAvailableScopes): Map<string, string> {
  const names = new Map<string, string>();
  if (available.organization) names.set(available.organization.id, available.organization.name);
  for (const team of available.teams) names.set(team.id, team.name);
  for (const project of available.projects) names.set(project.id, project.name);
  return names;
}
