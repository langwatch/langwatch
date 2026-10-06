import {
  bindRestMiddleware,
  principalOfCredential,
  projectCredentialOfRequest,
} from "@langwatch/api/rest";
import { defineProcessModule } from "@langwatch/process";

import { SuiteModule } from "#app/suite.app";
import { suiteRunProcessingEventing } from "#eventing/suite-run-processing.pipeline";
import { suiteRepositories } from "#repositories/suite-repositories.registry";
import { suiteRunOriginFact } from "#rules/suite-wire-v1.rules";
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
  // Where a run was started from (surface header and caller key) - all three suite
  // families record it on the runs they queue, and nothing a process collaborator need answer.
  .withTransportFacts(() => [
    bindRestMiddleware(suiteRunOriginFact, (context) => {
      const principal = principalOfCredential(projectCredentialOfRequest(context.req.raw));
      return {
        surface: context.req.header("x-langwatch-surface") ?? null,
        callerKey: principal?.type === "apiKey" ? principal.id : null,
      };
    }),
  ])
  .withEventing(suiteRunProcessingEventing);
