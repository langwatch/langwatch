/** Kept separate from the composition so importing the router/app type never pulls in the installer. */
import type { MountableRestApp } from "@langwatch/api/rest";
import type { DatasetApi } from "@langwatch/dataset-contract";
import type { ApiTrpcContext, ApiTrpcFeatureMount } from "../../api.application.ts";
import type {
  createBatchRecordTrpcRouter,
  createDatasetRecordTrpcRouter,
  createDatasetTrpcRouter,
} from "./dataset-trpc.mount.ts";

/** The three namespaces, the `ctx.app.dataset` slice, and the REST family. */
export type ComposedDatasetFeature = Readonly<{
  routers(mount: ApiTrpcFeatureMount): {
    dataset: ReturnType<typeof createDatasetTrpcRouter<ApiTrpcContext>>;
    datasetRecord: ReturnType<typeof createDatasetRecordTrpcRouter<ApiTrpcContext>>;
    batchRecord: ReturnType<typeof createBatchRecordTrpcRouter<ApiTrpcContext>>;
  };
  /** For `ctx.app.dataset`, which every other feature's peer wiring reads. */
  app: DatasetApi;
  /** `/api/dataset`, bound to this process's project-key door. */
  rest: MountableRestApp;
}>;
