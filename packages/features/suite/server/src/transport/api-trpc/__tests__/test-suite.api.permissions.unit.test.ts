/**
 * @vitest-environment node
 * @see specs/suites/test-suites.feature
 * A real enforcing policy over the built-in role's own grants, so both halves run.
 */
import {
  builtinRoleGrants,
  type AuthzPermission,
  type BuiltinRoleKey,
} from "@langwatch/authz-contract";
import { initTRPC, TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

import type { SuiteApp } from "#app/suite.app";
import type { SuiteTrpcContext } from "../../../rules/suite-trpc-context.rules";
import { SuiteTrpcApi } from "../suite.api";

const PROJECT_ID = "project_1";
const TEST_SUITE = { id: "test_suite_1", projectId: PROJECT_ID, name: "Refunds" };

function callerAs(role: BuiltinRoleKey) {
  const trpc = initTRPC.context<SuiteTrpcContext>().create();
  const listTestSuites = vi.fn(async () => [TEST_SUITE]);
  const createTestSuite = vi.fn(async () => TEST_SUITE);
  const archiveTestSuite = vi.fn(async () => TEST_SUITE);

  const router = SuiteTrpcApi.create(trpc, {
    protected: trpc.procedure,
    policy:
      (permission: AuthzPermission) =>
      <TProcedure>(procedure: TProcedure): TProcedure =>
        (
          procedure as {
            use: (fn: (opts: { next: () => unknown }) => unknown) => TProcedure;
          }
        ).use(({ next }) => {
          if (!builtinRoleGrants({ role, permission })) {
            throw new TRPCError({ code: "FORBIDDEN" });
          }
          return next();
        }),
  });

  const suites = {
    listTestSuites,
    createTestSuite,
    archiveTestSuite,
  } as unknown as SuiteApp;

  return {
    caller: router.createCaller({
      app: { suites },
      actor: () => ({ id: "user_lena" }),
    } as unknown as SuiteTrpcContext),
    createTestSuite,
    archiveTestSuite,
  };
}

describe("given a person with read-only access to the project", () => {
  describe("when they open the test suites rail and then try to change it", () => {
    /** @scenario "A viewer can read test suites but cannot create or archive one" */
    it("lists every test suite and refuses both writes", async () => {
      const { caller, createTestSuite, archiveTestSuite } = callerAs("viewer");

      await expect(caller.testSuites.getAll({ projectId: PROJECT_ID })).resolves.toMatchObject([
        { id: TEST_SUITE.id },
      ]);

      await expect(
        caller.testSuites.create({ projectId: PROJECT_ID, name: "Mine" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        caller.testSuites.archive({ projectId: PROJECT_ID, testSuiteId: TEST_SUITE.id }),
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

      await expect(
        caller.testSuites.create({ projectId: PROJECT_ID, name: "Mine" }),
      ).resolves.toMatchObject({ id: TEST_SUITE.id });
      await expect(
        caller.testSuites.archive({ projectId: PROJECT_ID, testSuiteId: TEST_SUITE.id }),
      ).resolves.toMatchObject({ id: TEST_SUITE.id });

      expect(createTestSuite).toHaveBeenCalledTimes(1);
      expect(archiveTestSuite).toHaveBeenCalledTimes(1);
    });
  });
});
