/**
 * What each contract declares of the browser's cache, keyed by procedure path: which reads
 * the sealed IndexedDB mirror keeps. Staleness is the query client's own default.
 */

import type { TrpcCachePolicy } from "@langwatch/kernel/contract";
import type { QueryClient, QueryKey } from "@tanstack/react-query";

/** How long a read persisted to disk may be restored; its cache entry lives as long. */
export const PERSISTED_QUERY_MAX_AGE = 24 * 60 * 60 * 1000;

/** What the declared contracts ask of the browser's cache. */
export type UiCachePlan = Readonly<{
  persisted: ReadonlySet<string>;
}>;

/** The version each cached read was last answered under, by query hash. */
export type UiQueryVersions = Map<string, string>;

/** What the transport needs to send `since` and keep a read's data on `unchanged`. */
export type UiVersionedReads = Readonly<{
  paths: ReadonlySet<string>;
  versions: UiQueryVersions;
  /** The cache the data is read from; a getter, as the transport is built before the client. */
  queryClient: () => QueryClient | undefined;
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
  const persisted = new Set<string>();

  for (const contract of contracts) {
    for (const [name, member] of Object.entries(contract.members)) {
      if (member.cache?.persist) persisted.add(`${contract.namespace}.${name}`);
    }
  }

  return { persisted };
}

/** Versioned reads whose cache is bound later: the shell's client is built after the transport. */
export type UiBindableVersionedReads = UiVersionedReads & {
  bind(queryClient: QueryClient): void;
};

/** No read opts in today; event-sourced reads will answer by projection cursor (ARCHITECTURE.md).
 */
export function createUiVersionedReads(): UiBindableVersionedReads {
  let bound: QueryClient | undefined;
  return {
    paths: new Set<string>(),
    versions: new Map<string, string>(),
    queryClient: () => bound,
    bind: (queryClient) => {
      bound = queryClient;
    },
  };
}

/** The dotted procedure path a tRPC query key was built from, or undefined for any other key. */
export function procedurePathOf(queryKey: QueryKey): string | undefined {
  const [path] = queryKey;
  if (!Array.isArray(path) || !path.every((segment) => typeof segment === "string")) return;
  return path.join(".");
}
