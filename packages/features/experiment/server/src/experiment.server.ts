import { ExperimentApi } from "@langwatch/experiment-contract";
import { defineFeature, type FeatureSetup } from "@langwatch/runtime-composition";
import { ExperimentApp, type ExperimentAppDependencies } from "#app/experiment.app";

export type { ExperimentAppDependencies };

export const experimentServer = defineFeature("experiment")
  .withApp({
    contract: ExperimentApi,
    dependencies: {},
    create: (
      setup: FeatureSetup<Readonly<Record<never, never>>, ExperimentAppDependencies, undefined>,
    ) => ExperimentApp.create(setup),
  })
  .build();
