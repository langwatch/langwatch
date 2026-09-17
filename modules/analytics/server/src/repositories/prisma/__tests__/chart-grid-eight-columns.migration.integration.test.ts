/**
 * The one-time conversion of chart placements from the two-column grid to
 * the eight-column one, via the `chart_grid_eight_columns` migration. Rows
 * are seeded in the old unit and the migration SQL run over them directly.
 * @see specs/analytics/chart-grid-resize.feature
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

const databaseUrl = process.env.DATABASE_URL;
const connection = databaseUrl
  ? PrismaConnectionService.create({
      guard: new AllowTestQueries(),
      logger: createLogger("langwatch:analytics:chart-grid-migration-test"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }))
  : null;

function database(): PrismaClient {
  if (connection === null) {
    throw new Error("DATABASE_URL is required for chart grid migration tests");
  }

  return connection.client;
}

const MIGRATION_SQL = readFileSync(
  join(process.cwd(), "prisma/migrations/20260904060004_chart_grid_eight_columns/migration.sql"),
  "utf8",
);

/** Each statement of the migration, scoped to the test project so the run touches nothing else. */
const statementsScopedTo = (projectId: string): string[] =>
  MIGRATION_SQL.split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0)
    .map((statement) => `${statement} AND "projectId" = '${projectId}'`);

describe.skipIf(!databaseUrl)("the chart grid eight-column migration", () => {
  const projectId = `test-project-${nanoid()}`;
  const organizationId = `test-org-${nanoid()}`;
  const teamId = `test-team-${nanoid()}`;
  const ids = {
    builderWide: nanoid(),
    workbenchTall: nanoid(),
    widgetLarge: nanoid(),
  };

  beforeAll(async () => {
    const organization = await database().organization.create({
      data: {
        id: organizationId,
        name: "Grid org",
        slug: `grid-org-${nanoid()}`,
      },
    });
    const team = await database().team.create({
      data: {
        id: teamId,
        name: "Grid team",
        slug: `grid-team-${nanoid()}`,
        organizationId: organization.id,
      },
    });
    await database().project.create({
      data: {
        id: projectId,
        name: "Grid project",
        slug: `grid-project-${nanoid()}`,
        apiKey: `grid-key-${nanoid()}`,
        teamId: team.id,
        language: "other",
        framework: "other",
      },
    });
    await database().customGraph.createMany({
      data: [
        // Old "Wide (2x1)" builder graph in the second dashboard row.
        {
          id: ids.builderWide,
          projectId,
          name: "wide",
          graph: {},
          kind: "builder",
          gridColumn: 0,
          gridRow: 1,
          colSpan: 2,
          rowSpan: 1,
        },
        // Old "Tall (1x2)" workbench chart in the right column.
        {
          id: ids.workbenchTall,
          projectId,
          name: "tall",
          graph: {},
          kind: "workbench_sql",
          gridColumn: 1,
          gridRow: 2,
          colSpan: 1,
          rowSpan: 2,
        },
        // Old "Large (2x2)" widget on the 350px-row authoring grid.
        {
          id: ids.widgetLarge,
          projectId,
          name: "large",
          graph: {},
          kind: "dashboard_srcdoc",
          gridColumn: 0,
          gridRow: 1,
          colSpan: 2,
          rowSpan: 2,
        },
      ],
    });
  });

  afterAll(async () => {
    await database().customGraph.deleteMany({ where: { projectId } });
    await database().project.deleteMany({ where: { id: projectId } });
    await database().team.deleteMany({ where: { id: teamId, organizationId } });
    await database().organization.deleteMany({ where: { id: organizationId } });
    await connection?.closeOnce();
  });

  describe("given cards sized with the old presets on both surfaces", () => {
    describe("when the migration runs over them", () => {
      /** @scenario "Every pre-existing card converts once, to the same size it already rendered at" */
      it("scales every placement to the new grid's columns and rows by the surface's old row height", async () => {
        for (const statement of statementsScopedTo(projectId)) {
          await database().$executeRawUnsafe(statement);
        }

        const rows = await database().customGraph.findMany({
          where: { projectId },
          select: {
            id: true,
            gridColumn: true,
            gridRow: true,
            colSpan: true,
            rowSpan: true,
          },
        });
        const byId = Object.fromEntries(rows.map((row) => [row.id, row]));

        // Dashboard surfaces: 2 -> 8 columns (x4), 240px -> 100px rows (x3).
        expect(byId[ids.builderWide]).toMatchObject({
          gridColumn: 0,
          gridRow: 3,
          colSpan: 8,
          rowSpan: 3,
        });
        expect(byId[ids.workbenchTall]).toMatchObject({
          gridColumn: 4,
          gridRow: 6,
          colSpan: 4,
          rowSpan: 6,
        });
        // Widget authoring grid: x4 columns, 350px -> 100px rows (x4).
        expect(byId[ids.widgetLarge]).toMatchObject({
          gridColumn: 0,
          gridRow: 4,
          colSpan: 8,
          rowSpan: 8,
        });
      });
    });
  });
});
