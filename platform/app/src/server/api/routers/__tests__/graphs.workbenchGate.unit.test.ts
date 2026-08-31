/**
 * Which kinds a card procedure may touch, and who decides.
 *
 * The read was gated on the workbench flag from the start; the three placement
 * *writes* were not, and the gap is the kind that never shows up as an error.
 * With the feature off a `workbench_sql` row left behind by a trial is invisible
 * on the grid — but an ungated `delete` by id would still remove it, and an
 * ungated layout write would silently rewrite the placement of a card the
 * surface never admitted existed. "The feature off sees exactly the old grid"
 * has to be true of every procedure, not just the one that lists rows.
 *
 * Asserted on the `kind` clause each procedure sends to Prisma, because that
 * clause *is* the gate: it is what decides whether a row is reachable at all,
 * and a procedure that dropped it would still return successfully.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "~/generated/prisma/client";
import { BUILDER_CHART_KIND, WORKBENCH_SQL_CHART_KIND } from "~/server/analytics/chartKinds";

import { createInnerTRPCContext } from "../../trpc";
import { appRouter } from "../../root";

vi.mock("~/server/app-layer/app", async () => {
  const { appPermissionsMock } = await import("~/test-utils/appPermissionsMock");
  return appPermissionsMock();
});

vi.mock("~/runtime/app/features/audit-log", () => ({
  auditLog: vi.fn(() => Promise.resolve()),
}));

vi.mock("../../../license-enforcement", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../license-enforcement")>();
  return { ...actual, enforceLicenseLimit: vi.fn() };
});

vi.mock("../../rbac", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../rbac")>();
  return {
    ...actual,
    resolveProjectPermission: vi
      .fn()
      .mockResolvedValue({ permitted: true, organizationRole: "MEMBER" }),
  };
});

// The gate itself, stubbed per test: this suite is about what each procedure
// DOES with the answer, not about how the flag resolves (which `access.ts` and
// its own tests own).
const lwqlEnabledMock = vi.fn();
vi.mock("~/server/analytics/lwql/access", () => ({
  lwqlEnabled: (args: unknown) => lwqlEnabledMock(args),
  LWQL_FLAG: "release_lwql_workbench",
}));

const findUnique = vi.fn();
const deleteGraph = vi.fn();
const update = vi.fn();
const findMany = vi.fn();
const transaction = vi.fn();

const createCaller = () => {
  const ctx = createInnerTRPCContext({
    session: { user: { id: "user_1" }, expires: "1" },
    permissionChecked: true,
  });
  ctx.prisma = {
    customGraph: {
      findUnique,
      delete: deleteGraph,
      update,
      findMany,
    },
    $transaction: transaction,
  } as unknown as PrismaClient;
  return appRouter.createCaller(ctx).graphs;
};

/** The `kind` clause of the first Prisma call a spy recorded. */
const kindClauseOf = (spy: ReturnType<typeof vi.fn>): unknown =>
  spy.mock.calls[0]?.[0]?.where?.kind;

const LAYOUT = {
  gridColumn: 0,
  gridRow: 0,
  colSpan: 1,
  rowSpan: 1,
} as const;

beforeEach(() => {
  vi.clearAllMocks();
  findUnique.mockResolvedValue({ id: "graph_1", kind: BUILDER_CHART_KIND });
  deleteGraph.mockResolvedValue({ id: "graph_1" });
  update.mockResolvedValue({ id: "graph_1" });
  findMany.mockResolvedValue([]);
  transaction.mockResolvedValue([]);
});

describe("the dashboard card procedures", () => {
  describe("given the workbench is on for the project", () => {
    beforeEach(() => {
      lwqlEnabledMock.mockResolvedValue(true);
    });

    it("lets delete reach a placed workbench row", async () => {
      await createCaller().delete({ projectId: "project_1", id: "graph_1" });

      expect(kindClauseOf(findUnique)).toEqual({
        in: [BUILDER_CHART_KIND, WORKBENCH_SQL_CHART_KIND],
      });
      expect(kindClauseOf(deleteGraph)).toEqual({
        in: [BUILDER_CHART_KIND, WORKBENCH_SQL_CHART_KIND],
      });
    });

    it("lets a layout write move a placed workbench row", async () => {
      await createCaller().updateLayout({
        projectId: "project_1",
        graphId: "graph_1",
        ...LAYOUT,
      });

      expect(kindClauseOf(update)).toEqual({
        in: [BUILDER_CHART_KIND, WORKBENCH_SQL_CHART_KIND],
      });
    });

    it("lets a batch reflow move placed workbench rows", async () => {
      await createCaller().batchUpdateLayouts({
        projectId: "project_1",
        layouts: [{ graphId: "graph_1", ...LAYOUT }],
      });

      expect(kindClauseOf(update)).toEqual({
        in: [BUILDER_CHART_KIND, WORKBENCH_SQL_CHART_KIND],
      });
    });
  });

  describe("given the workbench is off for the project", () => {
    beforeEach(() => {
      lwqlEnabledMock.mockResolvedValue(false);
    });

    it("scopes delete to builder rows, so a trial's row is not removable", async () => {
      await createCaller().delete({ projectId: "project_1", id: "graph_1" });

      // Not an `in` of one — the same clause the grid saw before the feature
      // existed, which is what "exactly the old grid" means.
      expect(kindClauseOf(findUnique)).toBe(BUILDER_CHART_KIND);
      expect(kindClauseOf(deleteGraph)).toBe(BUILDER_CHART_KIND);
    });

    it("scopes a layout write to builder rows", async () => {
      await createCaller().updateLayout({
        projectId: "project_1",
        graphId: "graph_1",
        ...LAYOUT,
      });

      expect(kindClauseOf(update)).toBe(BUILDER_CHART_KIND);
    });

    it("scopes a batch reflow to builder rows", async () => {
      await createCaller().batchUpdateLayouts({
        projectId: "project_1",
        layouts: [{ graphId: "graph_1", ...LAYOUT }],
      });

      expect(kindClauseOf(update)).toBe(BUILDER_CHART_KIND);
    });

    it("scopes the read to builder rows too, so the four agree", async () => {
      await createCaller().getAll({
        projectId: "project_1",
        dashboardId: "dashboard_1",
      });

      expect(kindClauseOf(findMany)).toBe(BUILDER_CHART_KIND);
    });
  });
});
