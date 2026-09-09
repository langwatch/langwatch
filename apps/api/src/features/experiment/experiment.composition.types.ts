/** Kept separate from the composition so importing the router/app type never pulls in adapters. */
import type { DatasetExperimentLookup } from "@langwatch/dataset-server";
import type { ExperimentApp, ExperimentService } from "@langwatch/experiment-server";
import type { ApiExperimentRun } from "../../app/api-experiment-run.composition.ts";

/** The `ctx.app.experiments` application and the run loop. The tRPC namespace
 * is not here: its transport is unconverted. */
export type ComposedExperimentFeature = Readonly<{
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
