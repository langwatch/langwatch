import {
  bindRestMiddleware,
  credentialPrincipalOfToken,
  projectCredentialOfRequest,
} from "@langwatch/api/rest";
import type { WorkbenchCredential } from "@langwatch/experiment-contract";
import { defineServerModule } from "@langwatch/kernel";

import { ExperimentApp, type ExperimentAppDependencies } from "#app/experiment.app";

import { experimentRunProcessingEventing } from "./eventing/experiment-run-processing.pipeline.ts";
import { experimentDspyStepsRest } from "./transport/experiment-dspy-steps.rest.ts";
import { experimentInitRest } from "./transport/experiment-init.rest.ts";
import { experimentV3Rest, experimentWorkbenchCredential } from "./transport/experiment-v3.rest.ts";
import { experimentWorkbenchRunRest } from "./transport/experiment-workbench-run.rest.ts";
import { experimentRest, experimentRestCredential } from "./transport/experiment.rest.ts";
import { experimentTrpcTransport } from "./transport/experiment.trpc.ts";

export type { ExperimentAppDependencies };

export const experimentServer = defineServerModule("experiment")
  .withApp(ExperimentApp)
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
  // This family answers behind the project door, so re-resolving the key here
  // would ask a second question that could answer differently from the door
  // that admitted the request. `experimentInitCaller` and `dspyStepsCaller`
  // are bound by the host instead: both families are PUBLIC-door, where
  // `projectCredentialOfRequest` always throws.
  .withTransportFacts(() => [
    bindRestMiddleware(experimentRestCredential, (context) =>
      credentialPrincipalOfToken(projectCredentialOfRequest(context.req.raw)),
    ),
    // The workbench family reads the key's PERSON, not the whole principal: a
    // legacy project key stands for nobody, and an api key stands for the
    // person it was issued to.
    bindRestMiddleware(experimentWorkbenchCredential, (context): WorkbenchCredential => {
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
  ])
  .withEventing(experimentRunProcessingEventing);
