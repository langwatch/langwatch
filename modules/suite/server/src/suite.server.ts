import { defineServerModule } from "@langwatch/runtime-composition";
import { SuiteApp } from "#app/suite.app";
import { suiteRepositories } from "#repositories/suite-repositories.registry";
import { suiteTrpcTransport } from "#transport/suite.trpc";
import { testSuiteTrpcTransport } from "#transport/test-suite.trpc";

export const suiteServer = defineServerModule("suite")
  .withRepositories(suiteRepositories)
  .withApp(SuiteApp)
  .withTransports(suiteTrpcTransport, testSuiteTrpcTransport)
  .build();
