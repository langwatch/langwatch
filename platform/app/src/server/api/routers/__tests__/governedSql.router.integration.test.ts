/**
 * @vitest-environment node
 *
 * Router-level tests for the governed SQL feature switch: one flag, checked
 * server-side, that darkens the whole surface. `availability` answers false —
 * which is what hides the navigation and the page — and `schema`/`query`
 * refuse outright with the named code, so a caller who skips the availability
 * question gets the same answer.
 *
 * Spec: specs/analytics/governed-sql-workbench.feature
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockFeatureFlagIsEnabled,
  mockDescribeSchema,
  mockExecute,
  deployment,
} = vi.hoisted(() => ({
  mockFeatureFlagIsEnabled: vi.fn().mockResolvedValue(true),
  mockDescribeSchema: vi.fn().mockReturnValue({ datasets: [] }),
  mockExecute: vi.fn().mockResolvedValue({
    columns: [],
    rows: [],
    statistics: { elapsedMs: 1, rowsRead: 0, bytesRead: 0, rowsReturned: 0 },
    truncated: false,
    diagnostics: [],
  }),
  /** Whether this deployment has a governed identity to run queries as. */
  deployment: { provisioned: true },
}));

vi.mock("~/server/featureFlag", () => ({
  featureFlagService: { isEnabled: mockFeatureFlagIsEnabled },
}));

vi.mock("~/server/analytics/governed-sql", () => ({
  getGovernedSqlService: () => ({
    available: deployment.provisioned,
    describeSchema: mockDescribeSchema,
    execute: mockExecute,
  }),
}));

vi.mock("../../rbac", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../rbac")>();
  return {
    ...actual,
    checkProjectPermission: vi.fn().mockImplementation(() => {
      return async ({ ctx, next }: any) =>
        next({ ctx: { ...ctx, permissionChecked: true } });
    }),
  };
});

vi.mock("../../utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils")>();
  return {
    ...actual,
    getUserProtectionsForProject: vi.fn().mockResolvedValue({}),
  };
});

import { governedSqlRouter } from "../analytics/governedSql";

const mockPrismaClient = {
  project: {
    findUnique: vi.fn().mockResolvedValue({
      id: "proj_test_123",
      apiKey: "key",
      team: { organizationId: "org_test_123" },
    }),
  },
} as any;

function createTestCaller() {
  const ctx = {
    session: { user: { id: "user_test_123" }, expires: "2099-01-01" },
    req: undefined,
    res: undefined,
    prisma: mockPrismaClient,
    permissionChecked: false,
    publiclyShared: false,
    organizationRole: undefined,
  } as any;

  return governedSqlRouter.createCaller(ctx);
}

/**
 * The procedure is named `query`, which collides with the caller's own legacy
 * `caller.query(path)` interop method — property access resolves to the
 * interop, not the procedure. The interop form reaches it unambiguously.
 */
function runQuery(
  caller: ReturnType<typeof createTestCaller>,
  input: { projectId: string; sql: string },
) {
  return (
    caller as unknown as {
      mutation: (path: string, input: unknown) => Promise<unknown>;
    }
  ).mutation("query", input);
}

describe("the governed SQL router's feature switch", () => {
  let caller: ReturnType<typeof createTestCaller>;

  beforeEach(() => {
    vi.clearAllMocks();
    deployment.provisioned = true;
    mockPrismaClient.project.findUnique.mockResolvedValue({
      id: "proj_test_123",
      apiKey: "key",
      team: { organizationId: "org_test_123" },
    });
    caller = createTestCaller();
  });

  afterEach(() => {
    mockFeatureFlagIsEnabled.mockResolvedValue(true);
  });

  describe("given the switch is on for the project", () => {
    beforeEach(() => {
      mockFeatureFlagIsEnabled.mockResolvedValue(true);
    });

    it("answers available and serves the schema and the query", async () => {
      await expect(
        caller.availability({ projectId: "proj_test_123" }),
      ).resolves.toEqual({ available: true });

      await caller.schema({ projectId: "proj_test_123" });
      expect(mockDescribeSchema).toHaveBeenCalled();

      await runQuery(caller, { projectId: "proj_test_123", sql: "SELECT 1" });
      expect(mockExecute).toHaveBeenCalled();
    });
  });

  describe("given the switch is off for the project", () => {
    beforeEach(() => {
      mockFeatureFlagIsEnabled.mockResolvedValue(false);
    });

    /** @scenario "The whole surface stays dark until the experimental feature switch is on" */
    it("answers unavailable, naming the switch as the gate that closed", async () => {
      await expect(
        caller.availability({ projectId: "proj_test_123" }),
      ).resolves.toEqual({ available: false, reason: "disabled" });
    });

    /** @scenario "The whole surface stays dark until the experimental feature switch is on" */
    it("refuses the schema with the named code and describes nothing", async () => {
      await expect(
        caller.schema({ projectId: "proj_test_123" }),
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        cause: { code: "governed_sql_not_enabled" },
      });
      expect(mockDescribeSchema).not.toHaveBeenCalled();
    });

    /** @scenario "The whole surface stays dark until the experimental feature switch is on" */
    it("refuses the query with the named code and runs nothing", async () => {
      await expect(
        runQuery(caller, { projectId: "proj_test_123", sql: "SELECT 1" }),
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        cause: { code: "governed_sql_not_enabled" },
      });
      expect(mockExecute).not.toHaveBeenCalled();
      // The switch itself resolves the project's organization, so the only
      // project reads are that lookup — nothing the execution path needs.
      for (const call of mockPrismaClient.project.findUnique.mock.calls) {
        expect(call[0].select).toEqual({
          team: { select: { organizationId: true } },
        });
      }
    });
  });

  describe("given a stored rule enabling the switch for one organization", () => {
    beforeEach(() => {
      // A fake of the rule itself rather than an assertion about the call: it
      // answers true only for this flag and that organization, so the surface
      // can only come on if the router resolved and passed the right one.
      mockFeatureFlagIsEnabled.mockImplementation(
        async (flag: string, context: { organizationId?: string }) =>
          flag === "release_governed_sql_workbench" &&
          context.organizationId === "org_test_123",
      );
    });

    /** @scenario "An organization-scoped rule can switch the workbench on" */
    it("switches the workbench on for that organization's project and no other", async () => {
      await expect(
        caller.availability({ projectId: "proj_test_123" }),
      ).resolves.toEqual({ available: true });

      mockPrismaClient.project.findUnique.mockResolvedValue({
        id: "proj_other_456",
        team: { organizationId: "org_other_456" },
      });

      await expect(
        caller.availability({ projectId: "proj_other_456" }),
      ).resolves.toEqual({ available: false, reason: "disabled" });
    });
  });

  describe("given the switch is on but the deployment is not provisioned", () => {
    beforeEach(() => {
      mockFeatureFlagIsEnabled.mockResolvedValue(true);
      deployment.provisioned = false;
    });

    /** @scenario "The workbench is unreachable while governed SQL is not provisioned" */
    it("answers unavailable, naming provisioning rather than the switch", async () => {
      await expect(
        caller.availability({ projectId: "proj_test_123" }),
      ).resolves.toEqual({ available: false, reason: "unprovisioned" });
    });
  });
});
