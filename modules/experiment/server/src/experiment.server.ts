import { bindRestMiddleware, credentialPrincipalOfToken, projectCredentialOfRequest } from "@langwatch/api/rest";
import { ExperimentApi } from "@langwatch/experiment-contract";
import { defineServerModule, type FeatureSetup } from "@langwatch/runtime-composition";
import { ExperimentApp, type ExperimentAppDependencies } from "#app/experiment.app";
import { dspyStepsCaller, experimentDspyStepsRest } from "./transport/experiment-dspy-steps.rest.ts";
import { experimentInitCaller, experimentInitRest } from "./transport/experiment-init.rest.ts";
import { experimentRest, experimentRestCredential } from "./transport/experiment.rest.ts";
import { experimentTrpcTransport } from "./transport/experiment.trpc.ts";

export type { ExperimentAppDependencies };

export const experimentServer = defineServerModule("experiment")
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
  // All three families answer behind the project door, so the project it
  // resolved is the project every one of them writes against: re-resolving the
  // key here would ask the key store a second question per request and could
  // answer differently from the door that admitted the request.
  .withTransportFacts(() => [
    bindRestMiddleware(experimentRestCredential, (context) =>
      credentialPrincipalOfToken(projectCredentialOfRequest(context.req.raw)),
    ),
    bindRestMiddleware(experimentInitCaller, (context) => {
      const project = projectCredentialOfRequest(context.req.raw).project;

      return { projectId: project.id, projectSlug: project.slug };
    }),
    bindRestMiddleware(dspyStepsCaller, (context) => ({
      projectId: projectCredentialOfRequest(context.req.raw).project.id,
    })),
  ])
  .build();
