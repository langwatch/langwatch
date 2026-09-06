/**
 * ComposedDatasetFeature, apart from the composition that builds it.
 *
 * The record type names this feature's application and its router; the
 * composition beside it opens repositories, adapters and byte stores. Every
 * program that only names `AppRouter` reaches this record, so the two live in
 * separate modules and the type's module imports no adapter.
 */
import type { DatasetApp } from "@langwatch/dataset-server";
import type { ApiTrpcFeatureMount } from "../../api.application";
import type { createBatchRecordTrpcRouter, createDatasetTrpcRouter } from "./dataset-trpc.mount";

/** The two namespaces and the `ctx.app.dataset` slice the REST family reads. */
export type ComposedDatasetFeature = Readonly<{
  routers(mount: ApiTrpcFeatureMount): {
    dataset: ReturnType<typeof createDatasetTrpcRouter>;
    batchRecord: ReturnType<typeof createBatchRecordTrpcRouter>;
  };
  /** For `ctx.app.dataset`. */
  app: DatasetApp;
}>;
