/**
 * @vitest-environment node
 * @see specs/suites/test-suites.feature
 * A real enforcing decision over the built-in role's own grants, so both
 * halves run.
 */
import { createTrpcRuntime } from "@langwatch/api/trpc";
import { builtinRoleGrants, type BuiltinRoleKey } from "@langwatch/authz-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { SuiteApi } from "@langwatch/suite-contract";
import { initTRPC } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

import { testSuiteTrpcTransport } from "../test-suite.trpc.ts";
import { suiteTrpcTestPorts, type SuiteTrpcTestContext } from "./suite.trpc.harness.ts";

const PROJECT_ID = "project_1";
const TEST_SUITE = {
  id: "test_suite_1",
  projectId: PROJECT_ID,
  name: "Refunds",
  slug: "refunds",
  description: null,
  scenarioIds: [],
  targets: [],
  repeatCount: 1,
  labels: [],
  simulatorModel: null,
  judgeModel: null,
  kind: "test_suite" as const,
  scope: null,
  archivedAt: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

function callerAs(role: BuiltinRoleKey) {
  const listTestSuites = vi.fn(async () => [TEST_SUITE]);
  const createTestSuite = vi.fn(async () => TEST_SUITE);
  const archiveTestSuite = vi.fn(async () => TEST_SUITE);

  const app = createApiFixture<SuiteApi>({ listTestSuites, createTestSuite, archiveTestSuite });
  const trpc = initTRPC.context<SuiteTrpcTestContext>().create();

  const router = createTrpcRuntime<SuiteTrpcTestContext>({
    root: trpc,
    procedure: trpc.procedure,
    ports: suiteTrpcTestPorts((permission) => builtinRoleGrants({ role, permission })),
  }).mount(testSuiteTrpcTransport, () => app);

  return {
    caller: router.createCaller({ actor: { id: "user_lena" } }),
    createTestSuite,
    archiveTestSuite,
  };
}

describe("given a person with read-only access to the project", () => {
  describe("when they open the test suites rail and then try to change it", () => {
    /** @scenario "A viewer can read test suites but cannot create or archive one" */
    it("lists every test suite and refuses both writes", async () => {
      const { caller, createTestSuite, archiveTestSuite } = callerAs("viewer");

      await expect(caller.getAll({ projectId: PROJECT_ID })).resolves.toMatchObject([
        { id: TEST_SUITE.id },
      ]);

      await expect(
        caller.create({ projectId: PROJECT_ID, name: "Mine" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        caller.archive({ projectId: PROJECT_ID, testSuiteId: TEST_SUITE.id }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      expect(createTestSuite).not.toHaveBeenCalled();
      expect(archiveTestSuite).not.toHaveBeenCalled();
    });
  });
});

describe("given a person with write access to the project", () => {
  describe("when they create and archive a test suite", () => {
    it("lets both writes through", async () => {
      const { caller, createTestSuite, archiveTestSuite } = callerAs("member");

      await expect(caller.create({ projectId: PROJECT_ID, name: "Mine" })).resolves.toMatchObject({
        id: TEST_SUITE.id,
      });
      await expect(
        caller.archive({ projectId: PROJECT_ID, testSuiteId: TEST_SUITE.id }),
      ).resolves.toMatchObject({ id: TEST_SUITE.id });

      expect(createTestSuite).toHaveBeenCalledTimes(1);
      expect(archiveTestSuite).toHaveBeenCalledTimes(1);
    });
  });
});
