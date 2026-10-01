import {
  bindRestMiddleware,
  credentialPrincipalOfToken,
  projectCredentialOfRequest,
} from "@langwatch/api/rest";
import { instantEvalRestCredential } from "@langwatch/instant-eval-contract";
import { defineProcessModule } from "@langwatch/process";

import { InstantEvalModule } from "./app/instant-eval.app.ts";
import { instantEvalEventing } from "./eventing/instant-eval-processing.pipeline.ts";
import { instantEvalRepositories } from "./repositories/instant-eval-repositories.registry.ts";
import { instantEvalRest } from "./transport/instant-eval.rest.ts";

export const instantEvalProcessModule = defineProcessModule("instant-eval")
  .withRepositories(instantEvalRepositories)
  .withApi(InstantEvalModule)
  .withTransports(instantEvalRest)
  // Every route of the family runs the statement as the KEY's own cut of the
  // project's content, so the door resolves the credential once and the
  // handlers never reach for it.
  .withTransportFacts(() => [
    bindRestMiddleware(instantEvalRestCredential, (context) =>
      credentialPrincipalOfToken(projectCredentialOfRequest(context.req.raw)),
    ),
  ])
  .withEventing(instantEvalEventing);
