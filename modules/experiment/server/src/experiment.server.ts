import { ExperimentApi } from "@langwatch/experiment-contract";
import { defineModule, type FeatureSetup } from "@langwatch/runtime-composition";
import { ExperimentApp, type ExperimentAppDependencies } from "#app/experiment.app";

export type { ExperimentAppDependencies };

export const experimentServer = defineModule("experiment")
  .withApp({
    contract: ExperimentApi,
    dependencies: {},
    create: (
      setup: FeatureSetup<Readonly<Record<never, never>>, ExperimentAppDependencies, undefined>,
    ) => ExperimentApp.create(setup),
  })
  .build();
