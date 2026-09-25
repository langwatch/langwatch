import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A day for organizations made from now on, and nothing for the ones that
 * already exist.
 *
 * READ OFF THE SCHEMA AND THE MIGRATION, because that is where the rule
 * actually lives — no TypeScript decides it, so a test that exercised code
 * would be testing something else. The pair is asserted together: the schema
 * says what a new row gets, the migration says what the existing rows keep,
 * and either one alone is half the promise.
 */

const root = join(__dirname, "../../../../..");
const schema = readFileSync(join(root, "prisma/schema.prisma"), "utf8");
const migration = readFileSync(
  join(
    root,
    "prisma/migrations/20260918171002_org_sign_in_security/migration.sql",
  ),
  "utf8",
);

describe("the idle session window an organization starts with", () => {
  describe("given an organization created from now on", () => {
    /** @scenario "An organization made from now on starts with a day" */
    it("starts with a day of inactivity", () => {
      expect(schema).toMatch(
        /sessionIdleTimeoutMinutes\s+Int\s+@default\(1440\)/,
      );
      expect(migration).toMatch(
        /ALTER COLUMN "sessionIdleTimeoutMinutes" SET DEFAULT 1440/,
      );
    });
  });

  describe("given organizations that already existed", () => {
    it("adds the column at zero, so the deploy signs nobody out", () => {
      // THE TWO STATEMENTS ARE THE WHOLE SAFEGUARD. `ADD COLUMN NOT NULL
      // DEFAULT 1440` would write the day into every existing row and bound
      // sessions that were unbounded — collapsing this into one statement is
      // the regression this pins.
      expect(migration).toMatch(
        /ADD COLUMN "sessionIdleTimeoutMinutes" INTEGER NOT NULL DEFAULT 0/,
      );
      expect(migration).not.toMatch(
        /ADD COLUMN "sessionIdleTimeoutMinutes" INTEGER NOT NULL DEFAULT 1440/,
      );
    });
  });
});
