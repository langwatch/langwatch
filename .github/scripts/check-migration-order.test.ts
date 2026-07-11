import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  checkSet,
  migrationSets,
  topLevelEntries,
  type SetInput,
} from "./check-migration-order.ts";

const clickhouse = migrationSets.find((set) => set.name === "ClickHouse")!;
const prisma = migrationSets.find((set) => set.name === "Prisma")!;

const input = (overrides: Partial<SetInput> = {}): SetInput => ({
  set: clickhouse,
  baseEntries: [],
  headEntries: [],
  mergeBaseEntries: [],
  touchedEntries: [],
  ...overrides,
});

describe("migration ordering check", () => {
  describe("given a pull request that only appends migrations", () => {
    it("passes when the new migration sorts after everything on the base branch", () => {
      const errors = checkSet(
        input({
          baseEntries: ["00040_a.sql", "00041_b.sql"],
          mergeBaseEntries: ["00040_a.sql", "00041_b.sql"],
          headEntries: ["00040_a.sql", "00041_b.sql", "00042_c.sql"],
        }),
      );

      assert.deepEqual(errors, []);
    });

    it("passes when the pull request adds nothing at all", () => {
      const errors = checkSet(
        input({
          baseEntries: ["00040_a.sql"],
          mergeBaseEntries: ["00040_a.sql"],
          headEntries: ["00040_a.sql"],
        }),
      );

      assert.deepEqual(errors, []);
    });
  });

  describe("when the base branch moved ahead of the pull request", () => {
    it("fails when a new migration sorts before a migration already on the base branch", () => {
      const errors = checkSet(
        input({
          baseEntries: ["00040_a.sql", "00041_merged-first.sql"],
          mergeBaseEntries: ["00040_a.sql"],
          headEntries: ["00040_a.sql", "00041_merged-first.sql", "00041_mine.sql"],
        }),
      );

      assert.equal(errors.length, 1);
      assert.match(errors[0]!, /00041_mine\.sql/);
      assert.match(errors[0]!, /reuses ordering key 41/);
    });

    it("fails when a new migration reuses a key below the highest on the base branch", () => {
      const errors = checkSet(
        input({
          baseEntries: ["00040_a.sql", "00041_b.sql", "00042_c.sql"],
          mergeBaseEntries: ["00040_a.sql"],
          headEntries: [
            "00040_a.sql",
            "00041_b.sql",
            "00042_c.sql",
            "00039_mine.sql",
          ],
        }),
      );

      assert.equal(errors.length, 1);
      assert.match(errors[0]!, /00039_mine\.sql/);
      assert.match(errors[0]!, /sorts at or before/);
    });

    it("fails for a Prisma migration timestamped before one already merged", () => {
      const errors = checkSet(
        input({
          set: prisma,
          baseEntries: [
            "20260708150000_merged_later",
            "20260101000000_old",
          ],
          mergeBaseEntries: ["20260101000000_old"],
          headEntries: [
            "20260708150000_merged_later",
            "20260101000000_old",
            "20260702090000_mine",
          ],
        }),
      );

      assert.equal(errors.length, 1);
      assert.match(errors[0]!, /20260702090000_mine/);
      assert.match(errors[0]!, /20260708150000/);
    });
  });

  describe("when the pull request rewrites merged history", () => {
    it("fails when a migration that exists on the base branch is modified", () => {
      const errors = checkSet(
        input({
          baseEntries: ["00040_a.sql"],
          mergeBaseEntries: ["00040_a.sql"],
          headEntries: ["00040_a.sql"],
          touchedEntries: ["00040_a.sql"],
        }),
      );

      assert.equal(errors.length, 1);
      assert.match(errors[0]!, /immutable history/);
    });

    it("fails when a merged migration is deleted", () => {
      const errors = checkSet(
        input({
          baseEntries: ["00040_a.sql", "00041_b.sql"],
          mergeBaseEntries: ["00040_a.sql", "00041_b.sql"],
          headEntries: ["00040_a.sql"],
          touchedEntries: ["00041_b.sql"],
        }),
      );

      assert.equal(errors.length, 1);
      assert.match(errors[0]!, /00041_b\.sql/);
      assert.match(errors[0]!, /immutable history/);
    });

    it("ignores changes to a migration the pull request itself introduced", () => {
      const errors = checkSet(
        input({
          baseEntries: ["00040_a.sql"],
          mergeBaseEntries: ["00040_a.sql"],
          headEntries: ["00040_a.sql", "00041_mine.sql"],
          touchedEntries: ["00041_mine.sql"],
        }),
      );

      assert.deepEqual(errors, []);
    });
  });

  describe("when the pull request adds two migrations with the same key", () => {
    it("fails on the duplicate key", () => {
      const errors = checkSet(
        input({
          baseEntries: ["00040_a.sql"],
          mergeBaseEntries: ["00040_a.sql"],
          headEntries: ["00040_a.sql", "00041_one.sql", "00041_two.sql"],
        }),
      );

      assert.equal(errors.length, 2);
      assert.ok(errors.every((error) => /share ordering key 41/.test(error)));
    });
  });

  describe("when a migration is named without an ordering key", () => {
    it("fails on the unparseable name", () => {
      const errors = checkSet(
        input({
          headEntries: ["add-thing.sql"],
        }),
      );

      assert.equal(errors.length, 1);
      assert.match(errors[0]!, /does not start with an ordering key/);
    });
  });

  describe("given raw git paths", () => {
    it("reduces nested Prisma paths to migration directory names", () => {
      const entries = topLevelEntries(
        [
          "langwatch/prisma/migrations/20260101000000_old/migration.sql",
          "langwatch/prisma/migrations/20260102000000_new/migration.sql",
          "langwatch/prisma/migrations/migration_lock.toml",
        ],
        "langwatch/prisma/migrations",
      );

      assert.deepEqual(entries, [
        "20260101000000_old",
        "20260102000000_new",
      ]);
    });
  });
});
