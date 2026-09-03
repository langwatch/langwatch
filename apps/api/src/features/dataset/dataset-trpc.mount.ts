/**
 * App-process transport mounts for the dataset vertical's three surfaces.
 *
 * Behaviour is package-owned (`@langwatch/dataset-server`); these supply the
 * process's root, authenticated procedure, policy chain, and the two things
 * the dataset package does not own — a permission probe for the SECOND project
 * a copy reaches, and the batch-evaluation reads, which are the host's because
 * the table is.
 *
 * All three answer from one `ctx.app.dataset`: a project's rows are one set,
 * and a second application over them would be a second answer to what a
 * dataset contains.
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
    { protected: service.protected, policy: (permission) => service.policy(permission) },
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
  });
}

/**
 * Mounts `batchRecord.*` on the app process's tRPC root.
 *
 * `TSummaries` and `TRecords` are inferred from the process's own reads rather
 * than fixed here, so the two rollups reach the client with the shape they have
 * always had instead of a narrowed copy of it.
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
    { protected: service.protected, policy: (permission) => service.policy(permission) },
    mount.ports,
  );
}
