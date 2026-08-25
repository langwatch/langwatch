/**
 * The dashboard list's card count and the grid read must agree.
 *
 * `DashboardRepository.findAll` used to count `graphs` with no `kind`
 * predicate while every graph-card procedure gates on `placeableKindFilter`,
 * so the list advertised `workbench_sql` rows the dashboard read would never
 * return (issue #7437). Asserted on the `kind` clause the count sends to
 * Prisma, in both flag states, because that clause IS the agreement: it is
 * derived from the same filter the card procedures call.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "~/generated/prisma/client";
import {
  BUILDER_CHART_KIND,
  WORKBENCH_SQL_CHART_KIND,
} from "~/server/analytics/chartKinds";
import { placeableKindFilter } from "~/server/analytics/placeableKindFilter";
import { DashboardService } from "../dashboard.service";

// The gate itself, stubbed per test: this suite is about the clause the count
// emits with each answer, not about how the flag resolves (which `access.ts`
// and its own tests own).
const lwqlEnabledMock = vi.fn();
vi.mock("~/server/analytics/lwql/access", () => ({
  lwqlEnabled: (args: unknown) => lwqlEnabledMock(args),
  LWQL_FLAG: "release_lwql_workbench",
}));

const findMany = vi.fn();

const createService = () => {
  const prisma = {
    dashboard: { findMany },
  } as unknown as PrismaClient;
  return { service: DashboardService.create(prisma), prisma };
};

/** The `kind` clause the graph count of the first recorded call is scoped by. */
const countKindClauseOf = (spy: ReturnType<typeof vi.fn>): unknown =>
  spy.mock.calls[0]?.[0]?.include?._count?.select?.graphs?.where?.kind;

beforeEach(() => {
  vi.clearAllMocks();
  findMany.mockResolvedValue([]);
});

describe("the dashboard list's card count", () => {
  describe("given the workbench is on for the project", () => {
    beforeEach(() => {
      lwqlEnabledMock.mockResolvedValue(true);
    });

    /** @scenario "The dashboard list counts exactly the cards the grid will render" */
    it("counts both placeable kinds, matching the grid read", async () => {
      const { service, prisma } = createService();

      await service.getAll("project_1");

      const gridClause = await placeableKindFilter({
        prisma,
        projectId: "project_1",
      });
      expect(countKindClauseOf(findMany)).toEqual({
        in: [BUILDER_CHART_KIND, WORKBENCH_SQL_CHART_KIND],
      });
      expect(countKindClauseOf(findMany)).toEqual(gridClause.kind);
    });
  });

  describe("given the workbench is off for the project", () => {
    beforeEach(() => {
      lwqlEnabledMock.mockResolvedValue(false);
    });

    /** @scenario "The dashboard list counts exactly the cards the grid will render" */
    it("counts only builder graphs, as it did before the feature existed", async () => {
      const { service, prisma } = createService();

      await service.getAll("project_1");

      const gridClause = await placeableKindFilter({
        prisma,
        projectId: "project_1",
      });
      expect(countKindClauseOf(findMany)).toEqual(BUILDER_CHART_KIND);
      expect(countKindClauseOf(findMany)).toEqual(gridClause.kind);
    });
  });
});
