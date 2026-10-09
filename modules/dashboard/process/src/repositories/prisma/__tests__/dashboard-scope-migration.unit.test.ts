/** The scope migration as shipped: additive, and safe to run twice. Spec: dashboards-v2 AC186. */
import { describe, expect, it } from "vitest";

import { dashboardScopeMigration } from "./dashboard-scope-migration.fixture.ts";

describe("the board scope migration", () => {
  describe("when it runs against the boards that exist", () => {
    /** @scenario "AC186 Scope: the migration keeps today's audience" */
    it("only adds: a column with a default, a nullable column and an index, then narrows My dashboards", () => {
      expect(dashboardScopeMigration().statements).toEqual([
        `ALTER TABLE "Dashboard" ADD COLUMN IF NOT EXISTS "scope" "DashboardScope" NOT NULL DEFAULT 'PROJECT'`,
        `ALTER TABLE "Dashboard" ADD COLUMN IF NOT EXISTS "organizationId" TEXT`,
        `CREATE INDEX IF NOT EXISTS "Dashboard_organizationId_scope_idx" ON "Dashboard" ("organizationId", "scope")`,
        `UPDATE "Dashboard" SET "scope" = 'PRIVATE' WHERE "name" = 'My dashboard' AND "createdById" IS NOT NULL AND "scope" = 'PROJECT'`,
      ]);
    });

    /** @scenario "AC186 Scope: the migration keeps today's audience" */
    it("creates the three scopes once, behind a guard a second run passes", () => {
      expect(dashboardScopeMigration().typeGuard).toBe(
        `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DashboardScope') THEN ` +
          `CREATE TYPE "DashboardScope" AS ENUM ('PRIVATE', 'PROJECT', 'ORGANIZATION'); END IF; END $$;`,
      );
    });
  });
});
