/**
 * Applies the cache tier each contract declares on its reads, keyed by
 * procedure path, so no call site states a staleTime. ADR-164.
 */

import type { TrpcCachePolicy, TrpcCacheTier } from "@langwatch/api/contract";
import { trpcQueryKey } from "@langwatch/api/web";
import type { Query, QueryClient, QueryKey } from "@tanstack/react-query";

/** How long a read of each tier stays fresh. */
export const CACHE_TIER_STALE_TIME: Readonly<Record<TrpcCacheTier, number>> = {
  live: 0,
  session: Number.POSITIVE_INFINITY,
  reference: 60 * 60 * 1000,
};

/** How long a read persisted to disk may be restored; its cache entry lives as long. */
export const PERSISTED_QUERY_MAX_AGE = 24 * 60 * 60 * 1000;

/** What the declared contracts ask of the browser's cache. */
export type UiCachePlan = Readonly<{
  tiers: ReadonlyMap<string, TrpcCacheTier>;
  persisted: ReadonlySet<string>;
}>;

/** The part of a built `TrpcContract` the plan reads. */
export type CacheDeclaringContract = Readonly<{
  namespace: string;
  members: Readonly<Record<string, Readonly<{ cache?: TrpcCachePolicy }>>>;
}>;

/** Folds every declared read's policy into one plan, keyed by dotted procedure path. */
export function cachePlanFor({
  contracts,
}: {
  contracts: readonly CacheDeclaringContract[];
}): UiCachePlan {
  const tiers = new Map<string, TrpcCacheTier>();
  const persisted = new Set<string>();

  for (const contract of contracts) {
    for (const [name, member] of Object.entries(contract.members)) {
      if (!member.cache) continue;
      const path = `${contract.namespace}.${name}`;
      tiers.set(path, member.cache.tier);
      if (member.cache.persist) persisted.add(path);
    }
  }

  return { tiers, persisted };
}

/** Session and reference reads travel as lone GETs, so each URL's ETag names one body (ADR-164). */
export function unbatchedCachePaths({ plan }: { plan: UiCachePlan }): ReadonlySet<string> {
  return new Set([...plan.tiers].flatMap(([path, tier]) => (tier === "live" ? [] : [path])));
}

/** The dotted procedure path a tRPC query key was built from, or undefined for any other key. */
export function procedurePathOf(queryKey: QueryKey): string | undefined {
  const [path] = queryKey;
  if (!Array.isArray(path) || !path.every((segment) => typeof segment === "string")) return;
  return path.join(".");
}

/** Registers each declared tier as the query defaults for its procedure (one call per key). */
export function applyCacheTiers({
  queryClient,
  plan,
}: {
  queryClient: QueryClient;
  plan: UiCachePlan;
}): void {
  for (const [path, tier] of plan.tiers) {
    queryClient.setQueryDefaults(trpcQueryKey(path), {
      staleTime: CACHE_TIER_STALE_TIME[tier],
      ...(plan.persisted.has(path) ? { gcTime: PERSISTED_QUERY_MAX_AGE } : {}),
    });
  }
}

/** Marks every session-tier read stale; the mounted ones refetch. */
export function invalidateSessionTier({
  queryClient,
  plan,
}: {
  queryClient: QueryClient;
  plan: UiCachePlan;
}): Promise<void> {
  return queryClient.invalidateQueries({
    predicate: (query: Query) =>
      plan.tiers.get(procedurePathOf(query.queryKey) ?? "") === "session",
  });
}
