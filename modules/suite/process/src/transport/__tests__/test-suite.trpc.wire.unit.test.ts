import { createApiFixture } from "@langwatch/api-fixture";
/**
 * @vitest-environment node
 * @see specs/suites/test-suites.feature
 * Composed the way the process root composes namespaces, so the paths asserted are main's wire.
 */
import { createTrpcRuntime } from "@langwatch/api/trpc";
import type { SuiteApi } from "@langwatch/suite-contract";
import { initTRPC } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

import { suiteTrpcTransport } from "../suite.trpc.ts";
import { testSuiteTrpcTransport } from "../test-suite.trpc.ts";
import { suiteTrpcTestMembers, type SuiteTrpcTestContext } from "./suite.trpc.harness.ts";

const PROJECT_ID = "project_1";
const TEST_SUITE = {
  id: "test_suite_1",
  projectId: PROJECT_ID,
  name: "Refunds v2",
  slug: "refunds",
  description: null,
  scenarioIds: [],
  targets: [],
  repeatCount: 1,
  labels: [],
  simulatorModel: null,
  judgeModel: null,
  fields: [],
  evaluators: [],
  kind: "test_suite" as const,
  scope: null,
  archivedAt: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

function composedRoot() {
  const updateTestSuite = vi.fn(async () => TEST_SUITE);
  const app = createApiFixture<SuiteApi>({ updateTestSuite });
  const trpc = initTRPC.context<SuiteTrpcTestContext>().create();
  const runtime = createTrpcRuntime<SuiteTrpcTestContext>({
    root: trpc,
    procedure: trpc.procedure,
    members: suiteTrpcTestMembers(),
  });

  const testSuites = runtime.mount(testSuiteTrpcTransport, () => app);
  const router = trpc.router({
    [suiteTrpcTransport.namespace]: runtime.mount(suiteTrpcTransport, () => app),
    [testSuiteTrpcTransport.namespace]: testSuites,
  });

  return {
    paths: Object.keys(router._def.procedures),
    caller: testSuites.createCaller({ actor: { id: "user_lena" } }),
    updateTestSuite,
  };
}

describe("the test suites tRPC namespace", () => {
  describe("when the process root composes it beside the suites namespace", () => {
    it("serves every test suite procedure under suites.testSuites, as main did", () => {
      const { paths } = composedRoot();

      expect(paths).toEqual(
        expect.arrayContaining([
          "suites.testSuites.create",
          "suites.testSuites.getAll",
          "suites.testSuites.rename",
          "suites.testSuites.archive",
          "suites.testSuites.update",
        ]),
      );
      expect(paths.filter((path) => path.startsWith("testSuites."))).toEqual([]);
    });
  });

  describe("when the suite editor saves a test suite", () => {
    /** @scenario "The suite editor saves a test suite's name, fields and evaluators through suites.testSuites.update" */
    it("passes the name, fields and evaluators through to the suite service", async () => {
      const { caller, updateTestSuite } = composedRoot();

      await expect(
        caller.update({
          projectId: PROJECT_ID,
          testSuiteId: TEST_SUITE.id,
          name: "Refunds v2",
          fields: [],
          evaluators: [],
        }),
      ).resolves.toMatchObject({ id: TEST_SUITE.id, name: "Refunds v2" });

      expect(updateTestSuite).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        testSuiteId: TEST_SUITE.id,
        name: "Refunds v2",
        fields: [],
        evaluators: [],
      });
    });
  });
});
