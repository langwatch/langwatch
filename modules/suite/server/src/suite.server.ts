import { defineServerModule } from "@langwatch/runtime-composition";
import { SuiteApp } from "#app/suite.app";
import { suiteRepositories } from "#repositories/suite-repositories.registry";
import { createRunPlansRest } from "#transport/run-plans.rest";
import { createSuitesAliasRest } from "#transport/suites-alias.rest";
import { createTestSuitesRest } from "#transport/test-suites.rest";
import { suiteTrpcTransport } from "#transport/suite.trpc";
import { testSuiteTrpcTransport } from "#transport/test-suite.trpc";

export const suiteServer = defineServerModule("suite")
  .withRepositories(suiteRepositories)
  .withApp(SuiteApp)
  .withTransports(
    createRunPlansRest(),
    createTestSuitesRest(),
    createSuitesAliasRest(),
    suiteTrpcTransport,
    testSuiteTrpcTransport,
  )
  .build();
