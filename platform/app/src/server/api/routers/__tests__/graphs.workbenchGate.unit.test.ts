/**
 * Which kinds a card procedure may touch.
 *
 * The read was gated on the workbench flag from the start; the three placement
 * *writes* were not, and the gap is the kind that never shows up as an error.
 * With the feature off a `workbench_sql` row left behind by a trial is invisible
 * on the grid — but an ungated `delete` by id would still remove it, and an
 * ungated layout write would silently rewrite the placement of a card the
 * surface never admitted existed. "The grid sees exactly the builder rows" has
 * to be true of every procedure, not just the one that lists rows.
 *
 * Asserted on the `kind` clause each procedure sends to Prisma, because that
 * clause *is* the gate: it is what decides whether a row is reachable at all,
 * and a procedure that dropped it would still return successfully.
 *
 * ## Where the clause is decided now
 *
 * The four procedures reach Prisma through the packaged chain — the `graphs.*`
 * transport calls `DashboardApp`, which calls `DashboardService`, which calls
 * `PrismaDashboardRepository` — so this file mounts that whole chain over a
 * Prisma stub rather than putting one on `ctx.prisma`, which the transport no
 * longer reads.
 *
 * The rollout flag no longer reaches this surface at all: the repository names
 * the builder kind unconditionally, and `graphs.*` takes no flag port. What
 * survives of the flag is `DashboardGraphVisibilityPolicyPort.placeableKinds`,
 * which decides only how many cards a dashboard reports
 * (`packages/features/dashboard/.../dashboard.service.unit.test.ts` and
 * `runtime/app/features/__tests__/dashboard-graph-visibility-policy.adapter.unit.test.ts`
 * own that). So the assertions here are unconditional, and a placed workbench
 * card is moved and removed through `analytics.savedWorkbenchCharts.*`, which
 * carries its own gate.
 */

import { LangWatchQLService } from "@langwatch/analytics-contract";
import {
  DashboardApp,
  DashboardGraphVisibilityPolicyPort,
  DashboardIdGenerator,
  PostgresDashboardAdapter,
  SavedWorkbenchChartPolicy,
} from "@langwatch/dashboard-server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BUILDER_CHART_KIND } from "~/server/analytics/chartKinds";

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

const findFirst = vi.fn();
const deleteGraph = vi.fn();
const update = vi.fn();
const findMany = vi.fn();
const transaction = vi.fn();

/**
 * The widest answer the visibility policy can give.
 *
 * Deliberately "both kinds", not "builder": if the flag could still widen this
 * surface, these assertions would fail rather than pass by accident.
 */
class EveryKindPlaceable extends DashboardGraphVisibilityPolicyPort {
  async placeableKinds(): Promise<readonly ("builder" | "workbench_sql")[]> {
    return ["builder", "workbench_sql"];
  }
}

class TestDashboardIds extends DashboardIdGenerator {
  generate(): string {
    return "dashboard-graph-test";
  }
}

class AllowSavedWorkbenchCharts extends SavedWorkbenchChartPolicy {
  validate(): void {}
}

/** No procedure under test runs a statement, so every member refuses. */
class UnusedLangWatchQL extends LangWatchQLService {
  readonly available = false;

  async close(): Promise<void> {}

  describeSchema(): never {
    throw new Error("not used by this test");
  }

  validate(): never {
    throw new Error("not used by this test");
  }

  execute(): never {
    throw new Error("not used by this test");
  }
}

const GRAPH_ROW = {
  id: "graph_1",
  projectId: "project_1",
  name: "A chart",
  graph: {},
  filters: null,
  dashboardId: "dashboard_1",
  gridColumn: 0,
  gridRow: 0,
  colSpan: 1,
  rowSpan: 1,
  createdAt: new Date(1),
  updatedAt: new Date(2),
};

const createCaller = () => {
  const ctx = createInnerTRPCContext({
    session: { user: { id: "user_1" }, expires: "1" },
    permissionChecked: true,
  });
  Object.defineProperty(ctx.app, "dashboard", {
    configurable: true,
    value: DashboardApp.create({
      dashboard: PostgresDashboardAdapter.create({
        database: {
          customGraph: { findFirst, delete: deleteGraph, update, findMany },
          $transaction: transaction,
        } as never,
        ids: new TestDashboardIds(),
        savedWorkbenchChartPolicy: new AllowSavedWorkbenchCharts(),
        graphVisibility: new EveryKindPlaceable(),
        langWatchQL: new UnusedLangWatchQL(),
      }).build(),
      automation: {
        getByCustomGraphIds: async () => [],
        tryGetByCustomGraphId: async () => null,
      },
    }),
  });
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
  findFirst.mockResolvedValue(GRAPH_ROW);
  deleteGraph.mockResolvedValue(GRAPH_ROW);
  update.mockResolvedValue(GRAPH_ROW);
  findMany.mockResolvedValue([]);
  transaction.mockResolvedValue([]);
});

describe("the dashboard card procedures", () => {
  describe("given a project whose workbench rows may be placed on the grid", () => {
    it("scopes delete to builder rows, so a trial's row is not removable", async () => {
      await createCaller().delete({ projectId: "project_1", id: "graph_1" });

      // Not an `in` of one — the same clause the grid saw before the feature
      // existed, which is what "exactly the builder rows" means. Both halves:
      // the read that admits the row exists, and the delete itself.
      expect(kindClauseOf(findFirst)).toBe(BUILDER_CHART_KIND);
      expect(kindClauseOf(deleteGraph)).toBe(BUILDER_CHART_KIND);
    });

    it("scopes a layout write to builder rows", async () => {
      await createCaller().updateLayout({
        projectId: "project_1",
        graphId: "graph_1",
        ...LAYOUT,
      });

      expect(kindClauseOf(findFirst)).toBe(BUILDER_CHART_KIND);
      expect(kindClauseOf(update)).toBe(BUILDER_CHART_KIND);
    });

    it("scopes a batch reflow to builder rows", async () => {
      await createCaller().batchUpdateLayouts({
        projectId: "project_1",
        layouts: [{ graphId: "graph_1", ...LAYOUT }],
      });

      expect(kindClauseOf(findFirst)).toBe(BUILDER_CHART_KIND);
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
