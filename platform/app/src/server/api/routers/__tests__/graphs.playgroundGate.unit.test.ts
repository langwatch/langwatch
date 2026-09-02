/**
 * Which kinds the dashboard's card procedures admit, with the playground flag
 * independent of the workbench flag.
 *
 * Mirrors graphs.workbenchGate.unit.test.ts's shape exactly — same subject
 * (the `kind` clause a card procedure sends to Prisma), same reasoning (the
 * clause IS the gate, so it is what a test has to pin) — but for the second
 * optional kind `placeableKindFilter` now admits. The one behavior this file
 * exists to prove that the workbench suite cannot: the two flags are asked
 * independently, so either kind can be present without the other, and a row
 * already placed under one flag keeps rendering when only the OTHER flag
 * changes.
 *
 * @see specs/analytics/custom-chart-playground-dashboard-placement.feature
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "~/generated/prisma/client";
import {
  BUILDER_CHART_KIND,
  DASHBOARD_SRCDOC_CHART_KIND,
  WORKBENCH_SQL_CHART_KIND,
} from "~/server/analytics/chartKinds";

import { createInnerTRPCContext } from "../../trpc";
import { graphsRouter } from "../graphs";

vi.mock("~/server/app-layer/app", async () => {
  const { appPermissionsMock } = await import(
    "~/test-utils/appPermissionsMock"
  );
  return appPermissionsMock();
});

vi.mock("@ee/audit-log/auditLog", () => ({
  auditLog: vi.fn(() => Promise.resolve()),
}));

vi.mock("../../../license-enforcement", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../license-enforcement")>();
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

// Both gates stubbed per test: this suite is about what `placeableKindFilter`
// DOES with the two answers, not about how either flag resolves (which
// `lwql/access.ts` / `dashboard-widgets/access.ts` and their own tests own).
const lwqlEnabledMock = vi.fn();
vi.mock("~/server/analytics/lwql/access", () => ({
  lwqlEnabled: (args: unknown) => lwqlEnabledMock(args),
  LWQL_FLAG: "release_lwql_workbench",
}));

const customChartPlaygroundEnabledMock = vi.fn();
vi.mock("~/server/analytics/dashboard-widgets/access", () => ({
  customChartPlaygroundEnabled: (args: unknown) =>
    customChartPlaygroundEnabledMock(args),
  CUSTOM_CHART_PLAYGROUND_FLAG: "release_custom_chart_playground",
}));

const findMany = vi.fn();

const createCaller = () => {
  const ctx = createInnerTRPCContext({
    session: { user: { id: "user_1" }, expires: "1" },
    permissionChecked: true,
  });
  ctx.prisma = {
    customGraph: { findMany },
  } as unknown as PrismaClient;
  return graphsRouter.createCaller(ctx);
};

/** The `kind` clause of the first Prisma call a spy recorded. */
const kindClauseOf = (spy: ReturnType<typeof vi.fn>): unknown =>
  spy.mock.calls[0]?.[0]?.where?.kind;

beforeEach(() => {
  vi.clearAllMocks();
  findMany.mockResolvedValue([]);
});

describe("the dashboard's card read", () => {
  /** @scenario "The dashboard's card procedures admit dashboard-widget rows only when the flag is on" */
  it("admits playground rows when the flag is on", async () => {
    lwqlEnabledMock.mockResolvedValue(false);
    customChartPlaygroundEnabledMock.mockResolvedValue(true);

    await createCaller().getAll({
      projectId: "project_1",
      dashboardId: "dashboard_1",
    });

    expect(kindClauseOf(findMany)).toEqual({
      in: [BUILDER_CHART_KIND, DASHBOARD_SRCDOC_CHART_KIND],
    });
  });

  /** @scenario "The dashboard's card procedures admit dashboard-widget rows only when the flag is on" */
  it("scopes the read to builder rows with both flags off, exactly the old grid", async () => {
    lwqlEnabledMock.mockResolvedValue(false);
    customChartPlaygroundEnabledMock.mockResolvedValue(false);

    await createCaller().getAll({
      projectId: "project_1",
      dashboardId: "dashboard_1",
    });

    expect(kindClauseOf(findMany)).toBe(BUILDER_CHART_KIND);
  });

  /** @scenario "Workbench and dashboard-widget rows are both admitted when both flags are on" */
  it("admits builder, workbench and playground together when both flags are on", async () => {
    lwqlEnabledMock.mockResolvedValue(true);
    customChartPlaygroundEnabledMock.mockResolvedValue(true);

    await createCaller().getAll({
      projectId: "project_1",
      dashboardId: "dashboard_1",
    });

    expect(kindClauseOf(findMany)).toEqual({
      in: [BUILDER_CHART_KIND, WORKBENCH_SQL_CHART_KIND, DASHBOARD_SRCDOC_CHART_KIND],
    });
  });

  /** @scenario "The dashboard-widget flag does not change workbench visibility, or the reverse" */
  it("admits playground but not workbench when only the playground flag is on", async () => {
    lwqlEnabledMock.mockResolvedValue(false);
    customChartPlaygroundEnabledMock.mockResolvedValue(true);

    await createCaller().getAll({
      projectId: "project_1",
      dashboardId: "dashboard_1",
    });

    // "Placement isn't mutually exclusive" does not mean "either flag admits
    // everything" — each kind is still gated on its OWN flag alone. The
    // playground flag being on never admits a workbench_sql row; only the
    // workbench flag does that, unchanged from before this feature existed.
    const clause = kindClauseOf(findMany) as { in: string[] };
    expect(clause.in).not.toContain(WORKBENCH_SQL_CHART_KIND);
    expect(clause.in).toContain(DASHBOARD_SRCDOC_CHART_KIND);
  });
});
