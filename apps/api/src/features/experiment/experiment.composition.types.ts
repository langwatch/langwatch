/**
 * ComposedExperimentFeature, apart from the composition that builds it.
 *
 * The record type names this feature's application and its router; the
 * composition beside it opens repositories, adapters and byte stores. Every
 * program that only names `AppRouter` reaches this record, so the two live in
 * separate modules and the type's module imports no adapter.
 */
import type { DatasetExperimentLookup } from "@langwatch/dataset-server";
import type { ExperimentService } from "@langwatch/experiment-contract";
import type { ExperimentApp } from "@langwatch/experiment-server";
import type { ApiTrpcFeatureMount } from "../../api.application";
import type { ApiExperimentRun } from "../../app/api-experiment-run.composition";
import type { createExperimentTrpcRouter } from "./experiment-trpc.mount";

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
