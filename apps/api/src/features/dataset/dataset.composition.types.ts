/** Kept separate from the composition so importing the router/app type never pulls in adapters. */
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
