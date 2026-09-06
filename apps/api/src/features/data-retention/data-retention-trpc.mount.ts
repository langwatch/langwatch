/**
 * The five `projectId` procedures use a plain declared permission; the three
 * `scope`-targeted ones gate in the resolver instead.
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
    validateOutput: service.validateOutput,
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
