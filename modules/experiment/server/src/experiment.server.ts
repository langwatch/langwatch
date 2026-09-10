import { ExperimentApi } from "@langwatch/experiment-contract";
import { defineModule, type FeatureSetup } from "@langwatch/runtime-composition";
import { ExperimentApp, type ExperimentAppDependencies } from "#app/experiment.app";
import { experimentDspyStepsRest } from "./transport/experiment-dspy-steps.rest.ts";
import { experimentInitRest } from "./transport/experiment-init.rest.ts";
import { experimentRest } from "./transport/experiment.rest.ts";
import { experimentTrpcTransport } from "./transport/experiment.trpc.ts";

export type { ExperimentAppDependencies };

export const experimentServer = defineModule("experiment")
  .withApp({
    contract: ExperimentApi,
    dependencies: {},
    create: (
      setup: FeatureSetup<Readonly<Record<never, never>>, ExperimentAppDependencies, undefined>,
    ) => ExperimentApp.create(setup),
  })
  .withTransports(
    experimentRest,
    experimentInitRest,
    experimentDspyStepsRest,
    experimentTrpcTransport,
  )
  .build();
