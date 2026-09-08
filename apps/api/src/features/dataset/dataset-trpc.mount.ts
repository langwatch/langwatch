/** Binds the feature's declared procedures to this process's execution path. */
import type { TrpcRuntime } from "@langwatch/api/trpc";
import type { DatasetApi } from "@langwatch/dataset-contract";
import {
  batchRecordTrpcTransport,
  datasetRecordTrpcTransport,
  datasetTrpcTransport,
} from "@langwatch/dataset-server";

/** The one slice of the process context these three namespaces read. */
export interface DatasetHostContext {
  app: Readonly<{ dataset: DatasetApi }>;
}

export function createDatasetTrpcRouter<TContext extends DatasetHostContext>(
  runtime: TrpcRuntime<TContext>,
) {
  return runtime.mount(datasetTrpcTransport, (ctx) => ctx.app.dataset);
}

export function createDatasetRecordTrpcRouter<TContext extends DatasetHostContext>(
  runtime: TrpcRuntime<TContext>,
) {
  return runtime.mount(datasetRecordTrpcTransport, (ctx) => ctx.app.dataset);
}

export function createBatchRecordTrpcRouter<TContext extends DatasetHostContext>(
  runtime: TrpcRuntime<TContext>,
) {
  return runtime.mount(batchRecordTrpcTransport, (ctx) => ctx.app.dataset);
}
