/**
 * The server half of `suites.testSuites.*`. A test suite is a suite of kind
 * "test_suite": it groups scenarios through Scenario.testSuiteId and runs them
 * through the ordinary suite run path.
 *
 * @see specs/suites/test-suites.feature
 */

import { defineTrpcRouter } from "@langwatch/api/trpc";
import { ScenarioTestSuiteNotFoundError } from "@langwatch/scenario-contract";
import { SuiteApi, SuiteNotFoundError, testSuiteTrpc } from "@langwatch/suite-contract";

/** The suite this id names, in the words the suites surface refuses with. */
function refuseAsSuite(error: unknown, testSuiteId: string): never {
  if (error instanceof ScenarioTestSuiteNotFoundError) throw new SuiteNotFoundError(testSuiteId);

  throw error;
}

export const testSuiteTrpcTransport = defineTrpcRouter(SuiteApi, testSuiteTrpc)
  .procedure("create")
  .withPermission("scenarios:manage")
  .handle(async ({ app, input }) => app.createTestSuite(input))

  .procedure("getAll")
  .withPermission("scenarios:view")
  .handle(async ({ app, input }) => app.listTestSuites(input))

  .procedure("rename")
  .withPermission("scenarios:manage")
  .handle(async ({ app, input }) =>
    app.renameTestSuite(input).catch((error: unknown) => refuseAsSuite(error, input.testSuiteId)),
  )

  .procedure("archive")
  .withPermission("scenarios:manage")
  .handle(async ({ app, input }) =>
    app.archiveTestSuite(input).catch((error: unknown) => refuseAsSuite(error, input.testSuiteId)),
  )
  .build();
