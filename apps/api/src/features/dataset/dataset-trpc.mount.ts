/**
 * Adds only the second-project permission probe for a copy and the
 * batch-evaluation reads; all three share one `ctx.app.dataset`.
 */
import { createTrpcApiService, type TrpcApiMount, type TrpcApiPorts } from "@langwatch/api/trpc";
import {
  BatchRecordTrpcApi,
  DatasetRecordTrpcApi,
  DatasetTrpcApi,
  type BatchRecordTrpcContext,
  type BatchRecordTrpcPorts,
  type DatasetRecordTrpcContext,
  type DatasetTrpcContext,
  type DatasetTrpcPorts,
} from "@langwatch/dataset-server";
import type { AnyTRPCRootTypes, TRPCRuntimeConfigOptions } from "@trpc/server";

/** Mounts `dataset.*` on the app process's tRPC root. */
export function createDatasetTrpcRouter<
  TContext extends DatasetTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
>(mount: TrpcApiMount<TContext, TOptions, TRoot> & TrpcApiPorts<DatasetTrpcPorts>) {
  const service = createTrpcApiService(mount);
  return DatasetTrpcApi.create(
    mount.root,
    {
      protected: service.protected,
      policy: (permission) => service.policy(permission),
      validateOutput: service.validateOutput,
    },
    mount.ports,
  );
}

/** Mounts `datasetRecord.*` on the app process's tRPC root. */
export function createDatasetRecordTrpcRouter<
  TContext extends DatasetRecordTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
>(mount: TrpcApiMount<TContext, TOptions, TRoot>) {
  const service = createTrpcApiService(mount);
  return DatasetRecordTrpcApi.create(mount.root, {
    protected: service.protected,
    policy: (permission) => service.policy(permission),
    validateOutput: service.validateOutput,
  });
}

/**
 * Mounts `batchRecord.*` on the tRPC root. `TSummaries`/`TRecords` are
 * inferred from the process's own reads so responses keep their real shapes.
 */
export function createBatchRecordTrpcRouter<
  TContext extends BatchRecordTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
  TSummaries,
  TRecords,
>(
  mount: TrpcApiMount<TContext, TOptions, TRoot> &
    TrpcApiPorts<BatchRecordTrpcPorts<TSummaries, TRecords>>,
) {
  const service = createTrpcApiService(mount);
  return BatchRecordTrpcApi.create(
    mount.root,
    {
      protected: service.protected,
      policy: (permission) => service.policy(permission),
      validateOutput: service.validateOutput,
    },
    mount.ports,
  );
}
