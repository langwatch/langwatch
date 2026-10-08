import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { clickhouseScanAt } from "../src/policies/persistence/clickhouse-table-ownership.ts";
import {
  lintMigrationOwnersAt,
  twoOwnerMigrations,
} from "../src/policies/persistence/migration-owners.ts";
import type { FeatureCatalogueEntry } from "../src/types.ts";
import { readFeatureCatalogue } from "../src/workspace/feature-catalogue.ts";

/**
 * @see packages/architecture-enforcer/specs/migration-owners.feature
 */

const here = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = join(here, "..", "..", "..");
const roots: string[] = [];

const SCHEMA = `model Project {
  id String @id
}
model ProjectSetting {
  id String @id
}
model Dataset {
  id String @id
}
model Scratch {
  id String @id
}
`;

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "migration-owners-"));
  roots.push(root);
  const catalogue: FeatureCatalogueEntry[] = [];
  const write = (path: string, source: string) => {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, source);
  };
  const feature = (id: string) => {
    if (catalogue.some((entry) => entry.id === id)) return;
    catalogue.push({ id, root: `modules/${id}`, classification: "core", subjects: [id] });
  };
  write("packages/prisma-client/prisma/schema.prisma", SCHEMA);
  write("packages/clickhouse-migrations/migrations/00000_seed.sql", "-- +goose Up\n");

  return {
    claims(id: string, ...models: string[]) {
      feature(id);
      const names = models.map((model) => `"${model}"`).join(", ");
      write(
        `modules/${id}/process/src/repositories/prisma/prisma.${id}.repository.ts`,
        `import { prismaTables } from "@langwatch/prisma-client/ownership";
export class Repository { static readonly tables = prismaTables(${names}); }
`,
      );
    },
    writesClickhouse(id: string, table: string) {
      feature(id);
      write(
        `modules/${id}/process/src/repositories/clickhouse/clickhouse.${id}.repository.ts`,
        `export async function store(client: { insert: (options: unknown) => Promise<void> }) {
  await client.insert({ table: "${table}", values: [], format: "JSONEachRow" });
}
`,
      );
      write(
        `packages/clickhouse-migrations/migrations/0000${catalogue.length}_create_${table}.sql`,
        `-- +goose Up\nCREATE TABLE IF NOT EXISTS \${CLICKHOUSE_DATABASE}.${table} (TenantId String) ENGINE = MergeTree;\n`,
      );
    },
    postgres: (name: string, sql: string) =>
      write(`packages/prisma-client/prisma/migrations/${name}/migration.sql`, sql),
    clickhouse: (name: string, sql: string) =>
      write(`packages/clickhouse-migrations/migrations/${name}`, sql),
    files: () =>
      lintMigrationOwnersAt({ root, catalogue }).map((violation) => ({
        file: violation.file.slice(root.length + 1),
        message: violation.message,
      })),
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("migration owners", () => {
  describe("given a Postgres migration", () => {
    /** @scenario "A Postgres migration touching one owner's tables passes" */
    it("reports nothing when every table it alters has one owner", () => {
      const world = fixture();
      world.claims("project", "Project", "ProjectSetting");
      world.postgres(
        "1_one",
        'ALTER TABLE "Project" ADD COLUMN "x" TEXT;\nALTER TABLE "ProjectSetting" ADD COLUMN "y" TEXT;\n',
      );

      expect(world.files()).toEqual([]);
    });

    /** @scenario "A Postgres migration touching two owners' tables is refused naming both" */
    it("reports the file, naming both owners and a table of each", () => {
      const world = fixture();
      world.claims("project", "Project");
      world.claims("dataset", "Dataset");
      world.postgres(
        "2_two",
        'ALTER TABLE "Project" ADD COLUMN "x" TEXT;\nCREATE INDEX "Dataset_x_idx" ON "Dataset"("x");\n',
      );

      expect(world.files()).toEqual([
        {
          file: "packages/prisma-client/prisma/migrations/2_two/migration.sql",
          message:
            "This migration touches the tables of 2 owners: project (Project) and dataset (Dataset).",
        },
      ]);
    });

    /** @scenario "A Postgres data step reading another owner's table is refused" */
    it("counts a table read inside a data step", () => {
      const world = fixture();
      world.claims("project", "Project");
      world.claims("dataset", "Dataset");
      world.postgres(
        "3_backfill",
        'UPDATE "Dataset" d SET "x" = p."x" FROM "Project" p WHERE p."id" = d."projectId";\n',
      );

      expect(world.files().map((finding) => finding.message)).toEqual([
        "This migration touches the tables of 2 owners: dataset (Dataset) and project (Project).",
      ]);
    });

    /** @scenario "A table no module owns does not count as an owner" */
    it("ignores a table no module claims", () => {
      const world = fixture();
      world.claims("project", "Project");
      world.postgres(
        "4_unclaimed",
        'ALTER TABLE "Project" ADD COLUMN "x" TEXT;\nALTER TABLE "Scratch" ADD COLUMN "y" TEXT;\n',
      );

      expect(world.files()).toEqual([]);
    });

    /** @scenario "A foreign key reference is not a touch" */
    it("ignores the table a foreign key references", () => {
      const world = fixture();
      world.claims("project", "Project");
      world.claims("dataset", "Dataset");
      world.postgres(
        "5_reference",
        'ALTER TABLE "Dataset" ADD CONSTRAINT "Dataset_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;\n',
      );

      expect(world.files()).toEqual([]);
    });
  });

  describe("given a ClickHouse migration", () => {
    let world: ReturnType<typeof fixture>;

    beforeEach(() => {
      world = fixture();
      world.writesClickhouse("trace", "trace_summaries");
      world.writesClickhouse("analytics", "evaluation_analytics");
    });

    /** @scenario "A ClickHouse migration touching two owners' tables is refused naming both" */
    it("reports the file, naming both writing modules", () => {
      world.clickhouse(
        "00200_both.sql",
        "-- +goose Up\nALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries ADD COLUMN X String;\nALTER TABLE ${CLICKHOUSE_DATABASE}.evaluation_analytics ADD COLUMN X String;\n",
      );

      expect(world.files()).toEqual([
        {
          file: "packages/clickhouse-migrations/migrations/00200_both.sql",
          message:
            "This migration touches the tables of 2 owners: trace (trace_summaries) and analytics (evaluation_analytics).",
        },
      ]);
    });

    /** @scenario "A ClickHouse rollback half is not read" */
    it("reads only the up half", () => {
      world.clickhouse(
        "00201_down.sql",
        "-- +goose Up\nALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries ADD COLUMN X String;\n-- +goose Down\nALTER TABLE ${CLICKHOUSE_DATABASE}.evaluation_analytics DROP COLUMN X;\n",
      );

      expect(world.files()).toEqual([]);
    });
  });

  describe("given the frozen cutoffs", () => {
    /** @scenario "Migrations below the cutoff are frozen history" */
    it("does not read a migration below either cutoff", () => {
      const world = fixture();
      world.claims("project", "Project");
      world.claims("dataset", "Dataset");
      const sql =
        'ALTER TABLE "Project" ADD COLUMN "x" TEXT;\nALTER TABLE "Dataset" ADD COLUMN "y" TEXT;\n';
      world.postgres("20250101000000_old", sql);
      world.postgres("20260913120001_last_frozen", sql);

      expect(world.files()).toEqual([]);
    });
  });

  describe("given the tree", () => {
    const catalogue = readFeatureCatalogue(REPOSITORY_ROOT, []);

    /** @scenario "The tree has no two-owner migration above the cutoff" */
    it("finds no two-owner migration", () => {
      const found = twoOwnerMigrations({
        root: REPOSITORY_ROOT,
        catalogue,
        clickhouse: clickhouseScanAt(REPOSITORY_ROOT, catalogue),
      }).map((migration) => migration.file);

      expect(found, "split these migrations by owner").toEqual([]);
    }, 120_000);
  });
});
