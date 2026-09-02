/**
 * App-process transport mount for the data-retention settings surface.
 *
 * Behaviour is package-owned (`@langwatch/data-retention-server`); this
 * supplies the process's tRPC root, its authenticated procedure and the two
 * declaration kinds this surface's eight procedures were built with.
 *
 * The two kinds are not interchangeable. Five procedures act on the
 * `projectId` their input carries, so a plain declared permission covers them.
 * The other three act on `scope` — an organization, a team or a project named
 * separately — and `projectId` is not acted on at all there, so the real gate
 * runs inside the resolver and the declaration RECORDS which scope field
 * enforces it. Collapsing the two would either under-check the scope-targeted
 * three or claim a check the other five never make.
 */
import { createTrpcApiService, type TrpcApiMount } from "@langwatch/api/trpc";
import type { EnforcedScopeFields } from "@langwatch/authz-contract";
import {
  DataRetentionTrpcApi,
  type DataRetentionTrpcContext,
  type DataRetentionTrpcPolicy,
} from "@langwatch/data-retention-server";
import type { AnyTRPCRootTypes, TRPCRuntimeConfigOptions } from "@trpc/server";

/** Mounts `dataRetention.*` on the app process's tRPC root. */
export function createDataRetentionTrpcRouter<
  TContext extends DataRetentionTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
  TSnapshot,
  TStorageUsage,
>(
  options: TrpcApiMount<TContext, TOptions, TRoot> &
    Readonly<{ ports: DataRetentionTrpcPolicy<TSnapshot, TStorageUsage> }>,
) {
  const service = createTrpcApiService(options);
  return DataRetentionTrpcApi.create(options.root, {
    protected: service.protected,
    authz: {
      permission: service.policy,
      inResolver: (enforces: EnforcedScopeFields) =>
        service.serviceAuthorized({
          reason:
            "The authorized target is the organization, team or project named by `scope`, which is loaded in the resolver — the `projectId` this input also carries is not acted on.",
          permissions: ["organization:manage", "team:manage", "project:update"],
          enforces,
        }),
    },
    policy: options.ports,
  });
}
