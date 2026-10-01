import {
  bindRestHeader,
  bindRestMiddleware,
  principalOfCredential,
  projectCredentialOfRequest,
} from "@langwatch/api/rest";
import { defineProcessModule } from "@langwatch/process";

import { SuiteModule } from "#app/suite.app";
import { suiteRunProcessingEventing } from "#eventing/suite-run-processing.pipeline";
import { suiteRepositories } from "#repositories/suite-repositories.registry";
import { suiteCallerKeyFact, suiteSurfaceFact } from "#rules/suite-wire-v1.rules";
import { createRunPlansRest } from "#transport/run-plans.rest";
import { suiteTrpcTransport } from "#transport/suite.trpc";
import { createSuitesAliasRest } from "#transport/suites-alias.rest";
import { testSuiteTrpcTransport } from "#transport/test-suite.trpc";
import { createTestSuitesRest } from "#transport/test-suites.rest";

export const suiteProcessModule = defineProcessModule("suite")
  .withRepositories(suiteRepositories)
  .withApi(SuiteModule)
  .withTransports(
    createRunPlansRest(),
    createTestSuitesRest(),
    createSuitesAliasRest(),
    suiteTrpcTransport,
    testSuiteTrpcTransport,
  )
  // Which surface started a run, off `X-LangWatch-Surface` - all three suite
  // families record it on the runs they queue, and nothing a process
  // collaborator need answer.
  .withTransportFacts(() => [
    bindRestHeader(suiteSurfaceFact, "x-langwatch-surface"),
    bindRestMiddleware(suiteCallerKeyFact, (context) => {
      const principal = principalOfCredential(projectCredentialOfRequest(context.req.raw));
      return principal?.type === "apiKey" ? principal.id : null;
    }),
  ])
  .withEventing(suiteRunProcessingEventing);
