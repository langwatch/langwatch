/**
 * The server half of `suites.testSuites.*`. A test suite is a suite of kind
 * "test_suite": it groups scenarios via `Scenario.testSuiteId` and runs
 * them through the ordinary suite run path.
 * @see specs/suites/test-suites.feature
 */

import { defineTrpcRouter } from "@langwatch/api/trpc";
import { SuiteApi, testSuiteTrpc } from "@langwatch/suite-contract";

export const testSuiteTrpcTransport = defineTrpcRouter(SuiteApi, testSuiteTrpc)
  .procedure("create")
  .withPermission("scenarios:manage")
  .handle(async ({ app, input }) => app.createTestSuite(input))

  .procedure("getAll")
  .withPermission("scenarios:view")
  .handle(async ({ app, input }) => app.listTestSuites(input))

  .procedure("rename")
  .withPermission("scenarios:manage")
  .handle(({ app, input }) => app.renameTestSuite(input))

  .procedure("update")
  .withPermission("scenarios:manage")
  .handle(({ app, input }) => app.updateTestSuite(input))

  .procedure("archive")
  .withPermission("scenarios:manage")
  .handle(({ app, input }) => app.archiveTestSuite(input))
  .build();
