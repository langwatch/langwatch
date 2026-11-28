/**
 * Spec: specs/ci/package-suite-integration-lane.feature
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { shippedMigrationsDigest } from "../migrations-digest.ts";

function migrationsDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "migrations-digest-"));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return dir;
}

describe("shippedMigrationsDigest", () => {
  describe("given the same migration files", () => {
    it("names them alike", () => {
      const files = { "00001_a.sql": "CREATE TABLE a (x UInt8)", "00002_b.sql": "SELECT 1" };
      expect(shippedMigrationsDigest({ migrationsDir: migrationsDir(files) })).toBe(
        shippedMigrationsDigest({ migrationsDir: migrationsDir(files) }),
      );
    });
  });

  describe("given one file's content changes", () => {
    /** @scenario "The template is named by the migrations it holds" */
    it("changes the digest", () => {
      const before = migrationsDir({ "00001_a.sql": "CREATE TABLE a (x UInt8)" });
      const after = migrationsDir({ "00001_a.sql": "CREATE TABLE a (x UInt16)" });
      expect(shippedMigrationsDigest({ migrationsDir: before })).not.toBe(
        shippedMigrationsDigest({ migrationsDir: after }),
      );
    });
  });

  describe("given a file that is not a migration", () => {
    it("leaves it out", () => {
      const sql = { "00001_a.sql": "CREATE TABLE a (x UInt8)" };
      expect(
        shippedMigrationsDigest({ migrationsDir: migrationsDir({ ...sql, "README.md": "notes" }) }),
      ).toBe(shippedMigrationsDigest({ migrationsDir: migrationsDir(sql) }));
    });
  });

  describe("given the shipped migrations", () => {
    it("returns a sixteen-character hex name", () => {
      expect(shippedMigrationsDigest()).toMatch(/^[0-9a-f]{16}$/);
    });
  });
});
