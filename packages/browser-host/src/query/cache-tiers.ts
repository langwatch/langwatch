/**
 * Which declared reads the sealed IndexedDB mirror keeps, keyed by procedure path: every query
 * but the named exclusions (ARCHITECTURE.md §10.2), each with its schema hash. Staleness is the
 * query client's own default.
 */

import { schemaHashOf, type TrpcContract, type TrpcContractMember } from "@langwatch/module";
import type { QueryKey } from "@tanstack/react-query";

/** The query client's gcTime default: how long a read's cache entry lives once unobserved. */
export const PERSISTED_QUERY_MAX_AGE = 24 * 60 * 60 * 1000;

/**
 * Reads kept off the disk mirror, by dotted procedure path: ones so high-traffic that sealing
 * every answer costs more than a reload saves. A read too large is skipped by size instead.
 */
export const UI_QUERY_MIRROR_EXCLUDED: ReadonlySet<string> = new Set<string>();

/** What the declared contracts ask of the browser's cache. */
export type UiCachePlan = Readonly<{
  /** Every mirrored read's path. */
  persisted: ReadonlySet<string>;
  /** A mirrored read's schema hash; a row stored under another is dropped. */
  schemaHashFor: (path: string) => string | undefined;
}>;

/** The version each cached read was last answered under, by query hash. */
export type UiQueryVersions = Map<string, string>;

/** The part of a built `TrpcContract` the plan reads. */
export type CacheDeclaringContract = Pick<TrpcContract, "namespace" | "members">;

/** Every declared query but the excluded ones, keyed by dotted procedure path. */
export function cachePlanFor({
  contracts,
  excluded = UI_QUERY_MIRROR_EXCLUDED,
}: {
  contracts: readonly CacheDeclaringContract[];
  excluded?: ReadonlySet<string>;
}): UiCachePlan {
  const mirrored = new Map<string, TrpcContractMember>();

  for (const contract of contracts) {
    for (const [name, member] of Object.entries(contract.members)) {
      const path = `${contract.namespace}.${name}`;
      if (member.kind === "query" && !excluded.has(path)) mirrored.set(path, member);
    }
  }

  return {
    persisted: new Set(mirrored.keys()),
    schemaHashFor: (path) => {
      const member = mirrored.get(path);
      return member && schemaHashOf(member);
    },
  };
}

/** The dotted procedure path a tRPC query key was built from, or undefined for any other key. */
export function procedurePathOf(queryKey: QueryKey): string | undefined {
  const [path] = queryKey;
  if (!Array.isArray(path) || !path.every((segment) => typeof segment === "string")) return;
  return path.join(".");
}
