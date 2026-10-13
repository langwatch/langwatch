import { describe, expect, it } from "vitest";

import type { ManifestStep } from "../manifest.ts";
import { ownerFromTables, stampRelease, tablesTouched } from "../stamp.ts";

const codeStep: ManifestStep = {
  id: "dataset:content-to-object-storage",
  kind: "data",
  mode: "background",
  owner: "dataset",
  description: "Copies dataset content to object storage",
};

describe("stampRelease()", () => {
  describe("when the tree holds new Prisma folders, goose files and a declared code step", () => {
    /** @scenario "A stamped manifest lists Prisma folders, then goose versions, then code steps" */
    it("orders Prisma folders by name, goose versions ascending, then the code step", () => {
      const manifest = stampRelease({
        release: "3.21.0",
        previous: "3.20.1",
        cutAt: "2026-10-06T12:00:00+02:00",
        current: {
          prismaFolders: ["20261006000002_add_b", "20261006000001_add_a"],
          gooseFiles: ["00110_add_index.sql", "00105_create_meter.sql"],
          codeSteps: [codeStep],
        },
        shipped: new Set(),
        ownerOf: ({ id }) => (id.startsWith("prisma:") ? "dataset" : null),
      });

      expect(manifest).toEqual({
        release: "3.21.0",
        previous: "3.20.1",
        cutAt: "2026-10-06T12:00:00+02:00",
        steps: [
          {
            id: "prisma:20261006000001_add_a",
            kind: "postgres-schema",
            mode: "blocking",
            owner: "dataset",
            description: "Postgres schema: add a",
          },
          {
            id: "prisma:20261006000002_add_b",
            kind: "postgres-schema",
            mode: "blocking",
            owner: "dataset",
            description: "Postgres schema: add b",
          },
          {
            id: "clickhouse:00105",
            kind: "clickhouse-schema",
            mode: "blocking",
            owner: null,
            description: "ClickHouse schema: create meter",
          },
          {
            id: "clickhouse:00110",
            kind: "clickhouse-schema",
            mode: "blocking",
            owner: null,
            description: "ClickHouse schema: add index",
          },
          codeStep,
        ],
      });
    });
  });

  describe("when the previous tag holds a folder and an earlier manifest names the code step", () => {
    /** @scenario "A step the previous release or an earlier manifest shipped is not stamped again" */
    it("stamps only the steps neither shipped", () => {
      const manifest = stampRelease({
        release: "3.21.0",
        previous: "3.20.1",
        cutAt: "2026-10-06T12:00:00+02:00",
        current: {
          prismaFolders: ["20261001120000_old", "20261006000001_new"],
          gooseFiles: [],
          codeSteps: [codeStep],
        },
        shipped: new Set(["prisma:20261001120000_old", codeStep.id]),
        ownerOf: () => null,
      });

      expect(manifest.steps.map((step) => step.id)).toEqual(["prisma:20261006000001_new"]);
    });
  });
});

describe("ownerFromTables()", () => {
  const tableOwners = new Map([
    ["Dataset", "dataset"],
    ["DatasetRecord", "dataset"],
    ["Project", "project"],
  ]);

  describe("when a migration alters two tables of one module", () => {
    /** @scenario "A schema step is owned by the one module owning every table it touches" */
    it("attributes the step to that module", () => {
      const tables = tablesTouched({
        sql: `-- AlterTable "Project" in a comment is ignored
ALTER TABLE "Dataset" ADD COLUMN IF NOT EXISTS "storageKey" TEXT;
CREATE INDEX CONCURRENTLY IF NOT EXISTS "DatasetRecord_key_idx" ON "DatasetRecord"("key");
UPDATE "DatasetRecord" SET "key" = 'x' WHERE "key" IS NULL;`,
      });

      expect([...tables].toSorted()).toEqual(["Dataset", "DatasetRecord"]);
      expect(ownerFromTables({ tables, tableOwners })).toBe("dataset");
    });
  });

  describe("when a migration touches two modules' tables or an unowned one", () => {
    /** @scenario "A schema step touching two modules' tables, or an unowned table, has no owner" */
    it("leaves the owner empty", () => {
      const mixed = tablesTouched({
        sql: `ALTER TABLE "Dataset" ADD COLUMN "a" TEXT;
ALTER TABLE "Project" ADD CONSTRAINT "x" FOREIGN KEY ("d") REFERENCES "Dataset"("id") ON DELETE CASCADE ON UPDATE CASCADE;`,
      });
      const unowned = tablesTouched({
        sql: "CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.usage_meter (id String) ENGINE = Memory",
      });

      expect([...mixed].toSorted()).toEqual(["Dataset", "Project"]);
      expect(ownerFromTables({ tables: mixed, tableOwners })).toBeNull();
      expect([...unowned]).toEqual(["usage_meter"]);
      expect(ownerFromTables({ tables: unowned, tableOwners })).toBeNull();
    });
  });
});
