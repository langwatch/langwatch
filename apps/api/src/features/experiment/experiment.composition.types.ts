/** Kept separate from the composition so importing the router/app type never pulls in adapters. */
import type { DatasetExperimentLookup } from "@langwatch/dataset-server";
import type { ExperimentService } from "@langwatch/experiment-contract";
import type { ExperimentApp } from "@langwatch/experiment-server";
import type { ApiTrpcFeatureMount } from "../../api.application.ts";
import type { ApiExperimentRun } from "../../app/api-experiment-run.composition.ts";
import type { createExperimentTrpcRouter } from "./experiment-trpc.mount.ts";

/** The namespace, the `ctx.app.experiments` application and the run loop. */
export type ComposedExperimentFeature = Readonly<{
  router(mount: ApiTrpcFeatureMount): ReturnType<typeof createExperimentTrpcRouter>;
  /** For `ctx.app.experiments`, and for the packaged experiment REST family. */
  app: ExperimentApp;
  /** The experiment lookup a dataset resolves a borrowed name through. */
  experimentLookup: DatasetExperimentLookup;
  /** The run loop the three REST run doors dispatch through. */
  run: ApiExperimentRun;
  /**
   * The experiment service itself, where this process composed one.
   */
  experiments?: ExperimentService | undefined;
}>;
