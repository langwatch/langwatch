import {
  bindRestMiddleware,
  browserCallerOfRequest,
  credentialPrincipalOfToken,
  projectCredentialOfRequest,
} from "@langwatch/api/rest";
import { ExperimentApi } from "@langwatch/experiment-contract";
import { defineServerModule, type FeatureSetup } from "@langwatch/runtime-composition";
import { ExperimentApp, type ExperimentAppDependencies } from "#app/experiment.app";
import { dspyStepsCaller, experimentDspyStepsRest } from "./transport/experiment-dspy-steps.rest.ts";
import { experimentInitCaller, experimentInitRest } from "./transport/experiment-init.rest.ts";
import { experimentRest, experimentRestCredential } from "./transport/experiment.rest.ts";
import { experimentV3Rest, experimentWorkbenchCredential } from "./transport/experiment-v3.rest.ts";
import {
  experimentWorkbenchCaller,
  experimentWorkbenchRunRest,
} from "./transport/experiment-workbench-run.rest.ts";
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
    // The workbench's project-keyed family and the two doors a browser opens.
    // Both name `ExperimentV3RestApi`, which this module's own App answers:
    // one App reference serves every transport a module declares, so the token
    // a router names types the handler and nothing more.
    experimentV3Rest,
    experimentWorkbenchRunRest,
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
    // The workbench family reads the key's PERSON, not the whole principal: a
    // legacy project key stands for nobody, and an api key stands for the
    // person it was issued to.
    bindRestMiddleware(experimentWorkbenchCredential, (context) => {
      const credential = projectCredentialOfRequest(context.req.raw);
      if (credential.type === "legacyProjectKey") return { kind: "legacyProjectKey" };

      return {
        kind: "apiKey",
        userId: credential.userId,
        ...(credential.isLangySessionKey === void 0
          ? {}
          : { isLangySessionKey: credential.isLangySessionKey }),
      };
    }),
    // The two browser doors answer their own 401 and 403 in the sentences the
    // workbench renders, so the session door's answer reaches them as a fact
    // rather than as a refusal.
    bindRestMiddleware(experimentWorkbenchCaller, (context) => ({
      userId: browserCallerOfRequest(context.req.raw)?.userId ?? null,
    })),
  ]);
