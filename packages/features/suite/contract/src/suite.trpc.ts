/**
 * Every `suites.*` and `suites.testSuites.*` procedure, declared once. The
 * names are the browser's cache keys, so they are the wire names the surface
 * has always called.
 */

import { defineTrpcContract } from "@langwatch/api/contract";
import { scenarioTestSuiteSchema } from "@langwatch/scenario-contract";
import { z } from "zod";

import { suiteSchema } from "./suite.ts";
import {
  createSuiteTrpcInputSchema,
  createTestSuiteTrpcInputSchema,
  listSuitesTrpcInputSchema,
  renameTestSuiteTrpcInputSchema,
  runAllSuitesTrpcInputSchema,
  runPlanTrpcInputSchema,
  runSuiteTrpcInputSchema,
  suiteArchivedNamesSchema,
  suiteArchivedNamesTrpcInputSchema,
  suiteOrTestSuiteSchema,
  suiteProjectInputSchema,
  suiteRunAllReceiptSchema,
  suiteRunPlanReceiptSchema,
  suiteRunReceiptSchema,
  suiteRunSummarySchema,
  suiteSummariesTrpcInputSchema,
  suiteTrpcIdInputSchema,
  testSuiteTrpcIdInputSchema,
  updateSuiteTrpcInputSchema,
} from "./suite-trpc.schemas.ts";

export const suiteTrpc = defineTrpcContract("suites")
  .mutation("create")
  .withInput(createSuiteTrpcInputSchema)
  .withOutput(suiteSchema)

  // The kinds default is "run_plan": v1 callers name no kind and must never
  // receive test suite rows. v2 callers name what they want.
  .query("getAll")
  .withInput(listSuitesTrpcInputSchema)
  .withOutput(suiteOrTestSuiteSchema.array())

  .query("getById")
  .withInput(suiteTrpcIdInputSchema)
  .withOutput(suiteOrTestSuiteSchema)

  .mutation("update")
  .withInput(updateSuiteTrpcInputSchema)
  .withOutput(suiteOrTestSuiteSchema)

  .mutation("duplicate")
  .withInput(suiteTrpcIdInputSchema)
  .withOutput(suiteSchema)

  .mutation("archive")
  .withInput(suiteTrpcIdInputSchema)
  .withOutput(suiteSchema)

  .query("resolveArchivedNames")
  .withInput(suiteArchivedNamesTrpcInputSchema)
  .withOutput(suiteArchivedNamesSchema)

  .mutation("run")
  .withInput(runSuiteTrpcInputSchema)
  .withOutput(suiteRunReceiptSchema)

  /**
   * A run under a NAME, which is what identifies a plan: the name joins the
   * plan already there and replaces its config, or creates one. `run` takes a
   * plan id instead.
   * @see specs/suites/run-plan-identity-by-name.feature
   */
  .mutation("runPlan")
  .withInput(runPlanTrpcInputSchema)
  .withOutput(suiteRunPlanReceiptSchema)

  /**
   * Runs every non-archived test case of the project through the managed
   * "All test cases" suite (created on first use, refreshed at each run).
   */
  .mutation("runAll")
  .withInput(runAllSuitesTrpcInputSchema)
  .withOutput(suiteRunAllReceiptSchema)

  .query("getSummaries")
  .withInput(suiteSummariesTrpcInputSchema)
  .withOutput(z.record(z.string(), suiteRunSummarySchema))
  .build();

/**
 * A test suite groups scenarios through Scenario.testSuiteId and runs them the
 * ordinary way. The process mounts this namespace under `suites.testSuites.*`.
 * @see specs/suites/test-suites.feature
 */
export const testSuiteTrpc = defineTrpcContract("testSuites")
  .mutation("create")
  .withInput(createTestSuiteTrpcInputSchema)
  .withOutput(scenarioTestSuiteSchema)

  // scenarioIds is the reconciled member cache, which is what the UI reads.
  .query("getAll")
  .withInput(suiteProjectInputSchema)
  .withOutput(scenarioTestSuiteSchema.array())

  .mutation("rename")
  .withInput(renameTestSuiteTrpcInputSchema)
  .withOutput(scenarioTestSuiteSchema)

  .mutation("archive")
  .withInput(testSuiteTrpcIdInputSchema)
  .withOutput(scenarioTestSuiteSchema)
  .build();
