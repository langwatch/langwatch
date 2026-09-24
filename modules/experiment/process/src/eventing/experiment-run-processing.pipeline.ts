/**
 * Experiment's run pipeline, ported from the deleted `ExperimentWorkerFeatureInstaller`:
 * the app builds the definition, and the senders are bound back to it once registered.
 */
import { defineEventingModule, type EventingSetup } from "@langwatch/eventing";

import type { ExperimentApp } from "../app/experiment.app.ts";

export const experimentRunProcessingEventing = defineEventingModule({
  pipeline: "experiment_run_processing",
  build: ({ app }: EventingSetup<never, ExperimentApp>) => app.eventingPipeline(),
  connect: ({ app, commands }) => app.connectCommands(commands),
});
