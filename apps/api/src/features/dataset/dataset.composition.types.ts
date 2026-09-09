/** Kept separate from the composition so importing the router/app type never pulls in the installer. */
import type { DatasetApi } from "@langwatch/dataset-contract";
import type { ApiTrpcContext, ApiTrpcFeatureMount } from "../../api.application.ts";
import type {
  createBatchRecordTrpcRouter,
  createDatasetRecordTrpcRouter,
  createDatasetTrpcRouter,
} from "./dataset-trpc.mount.ts";

/**
 * The three namespaces and the `ctx.app.dataset` slice. `/api/dataset` is
 * opened from the door registry over this same application, never from here.
 */
export type ComposedDatasetFeature = Readonly<{
  routers(mount: ApiTrpcFeatureMount): {
    dataset: ReturnType<typeof createDatasetTrpcRouter<ApiTrpcContext>>;
    datasetRecord: ReturnType<typeof createDatasetRecordTrpcRouter<ApiTrpcContext>>;
    batchRecord: ReturnType<typeof createBatchRecordTrpcRouter<ApiTrpcContext>>;
  };
  /** For `ctx.app.dataset`, which every other feature's peer wiring reads. */
  app: DatasetApi;
}>;
