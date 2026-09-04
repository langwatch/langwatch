/**
 * @vitest-environment node
 *
 * The period-placeholder rename migration, run against real data.
 *
 * Charts written before the reserved LangWatchQL names settled on
 * `period_start` / `period_end` / `period_granularity_seconds` still carry the
 * earlier `dashboard_context_*` spellings, which the surface no longer binds —
 * so every run refused with `lwql_parameter_missing`. This file runs the
 * migration's own SQL, read from the migration directory, so the rewrite under
 * test is the one that ships and not a copy of it.
 *
 * The SQL touches every chart in the database, so each case runs inside an
 * interactive transaction that is rolled back; only the seeded rows persist
 * until `afterAll` removes them.
 *
 * @see specs/analytics/custom-chart-playground-dashboard-placement.feature
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Prisma } from "~/generated/prisma/client";
import { prisma } from "~/server/db";
import { getTestUser } from "~/utils/testUtils";

const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../../prisma/migrations",
);

/** Found by name, not number: a migration is renumbered when `main` outruns it. */
function migrationPath(): string {
  const matches = readdirSync(MIGRATIONS_DIR).filter((name) =>
    name.endsWith("_dashboard_widget_period_parameter_names"),
  );
  if (matches.length !== 1) {
    throw new Error(
      `Expected one period-parameter-names migration, found ${matches.length}: ${matches.join(", ")}`,
    );
  }
  return join(MIGRATIONS_DIR, matches[0]!, "migration.sql");
}

/**
 * A migration runs before the Prisma client and its multitenancy middleware
 * exist, and it works on every project at once. The guard on raw queries has
 * to be told that, and this is the comment it reads.
 */
const TENANCY_OPTOUT =
  "-- @tenancy: a data migration, which runs over every project by design\n";

function migrationStatements(): string[] {
  const sql = readFileSync(migrationPath(), "utf8")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
  return sql
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0)
    .map((statement) => `${TENANCY_OPTOUT}${statement}`);
}

const statements = migrationStatements();
const projectId = `test-period-names-migration-${nanoid(8)}`;

const LEGACY_SQL = [
  "SELECT toStartOfInterval(OccurredAt, INTERVAL {dashboard_context_granularity_seconds:UInt32} SECOND) AS bucket,",
  "  count() AS events",
  "FROM traces",
  "WHERE OccurredAt >= {dashboard_context_period_start:DateTime}",
  "  AND OccurredAt < {dashboard_context_period_end:DateTime}",
  "GROUP BY bucket ORDER BY bucket",
].join("\n");

const CURRENT_SQL =
  "SELECT count() AS events FROM traces WHERE OccurredAt >= {period_start:DateTime} AND OccurredAt < {period_end:DateTime}";

const WIDGET_CODE = "export default function Chart() { return null; }";

const legacyId = `graph_${nanoid()}`;
const currentId = `graph_${nanoid()}`;

/** A sentinel thrown to roll the migration's writes back. */
class Rollback extends Error {
  constructor(readonly value: unknown) {
    super("rollback");
  }
}

async function withMigrationApplied<T>(
  read: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  try {
    await prisma.$transaction(
      async (tx) => {
        for (const statement of statements) {
          await tx.$executeRawUnsafe(statement);
        }
        throw new Rollback(await read(tx));
      },
      { timeout: 60_000, maxWait: 20_000 },
    );
  } catch (error) {
    if (error instanceof Rollback) return error.value as T;
    throw error;
  }
  throw new Error("the migration transaction was not rolled back");
}

type WidgetGraph = {
  version: number;
  code: string;
  queries: { name: string; sql: string; parameters?: unknown[] }[];
};

beforeAll(async () => {
  await getTestUser();
  const organization = await prisma.organization.findUnique({
    where: { slug: "test-organization" },
  });
  const team = await prisma.team.findFirst({
    where: { slug: "test-team", organizationId: organization!.id },
  });
  await prisma.project.create({
    data: {
      id: projectId,
      name: projectId,
      slug: projectId,
      apiKey: `sk-lw-${projectId}`,
      teamId: team!.id,
      language: "en",
      framework: "test",
    },
  });
  await prisma.customGraph.createMany({
    data: [
      {
        id: legacyId,
        projectId,
        name: "Written before the rename",
        kind: "dashboard_srcdoc",
        graph: {
          version: 1,
          code: WIDGET_CODE,
          queries: [
            {
              name: "main",
              sql: LEGACY_SQL,
              parameters: [
                { name: "minDurationMs", type: "number", default: 0 },
              ],
            },
          ],
        },
        gridColumn: 0,
        gridRow: 0,
        colSpan: 1,
        rowSpan: 1,
      },
      {
        id: currentId,
        projectId,
        name: "Already on the reserved names",
        kind: "dashboard_srcdoc",
        graph: {
          version: 1,
          code: WIDGET_CODE,
          queries: [{ name: "main", sql: CURRENT_SQL }],
        },
        gridColumn: 0,
        gridRow: 1,
        colSpan: 1,
        rowSpan: 1,
      },
    ],
  });
});

afterAll(async () => {
  await prisma.customGraph.deleteMany({ where: { projectId } });
  await prisma.project.deleteMany({ where: { id: projectId } });
});

describe("given saved charts written before and after the period placeholder rename", () => {
  describe("when the migration runs", () => {
    /** @scenario "Charts written with the earlier period placeholder names keep following the period" */
    it("rewrites the three legacy placeholders to the reserved names and leaves the rest of the definition as it was", async () => {
      const graph = await withMigrationApplied(async (tx) => {
        const row = await tx.customGraph.findFirst({
          where: { id: legacyId, projectId },
        });
        return row!.graph as WidgetGraph;
      });

      const [query] = graph.queries;
      expect(query!.sql).not.toContain("dashboard_context_");
      expect(query!.sql).toContain("{period_start:DateTime}");
      expect(query!.sql).toContain("{period_end:DateTime}");
      expect(query!.sql).toContain(
        "INTERVAL {period_granularity_seconds:UInt32} SECOND",
      );
      expect(query!.sql).toBe(
        LEGACY_SQL.replaceAll("{dashboard_context_period_", "{period_").replace(
          "{dashboard_context_granularity_seconds:",
          "{period_granularity_seconds:",
        ),
      );
      expect(query!.name).toBe("main");
      expect(query!.parameters).toEqual([
        { name: "minDurationMs", type: "number", default: 0 },
      ]);
      expect(graph.code).toBe(WIDGET_CODE);
      expect(graph.version).toBe(1);
    });

    /** @scenario "Charts written with the earlier period placeholder names keep following the period" */
    it("leaves a chart already on the reserved names untouched", async () => {
      const graph = await withMigrationApplied(async (tx) => {
        const row = await tx.customGraph.findFirst({
          where: { id: currentId, projectId },
        });
        return row!.graph as WidgetGraph;
      });

      expect(graph.queries[0]!.sql).toBe(CURRENT_SQL);
    });
  });
});
