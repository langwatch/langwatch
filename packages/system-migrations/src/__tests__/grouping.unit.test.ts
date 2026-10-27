import { describe, expect, it } from "vitest";

import { groupByTenantSource } from "../grouping.ts";
import type { SystemMigration } from "../system-migration.ts";
import type { TenantSource } from "../tenant-source.ts";
import type { TenantMigrationOutcome } from "../types.ts";

function source(ids: string[]): TenantSource {
  return {
    async findTenantIdsAfter(): Promise<string[]> {
      return ids;
    },
  };
}

function migration({
  name,
  candidateTenants,
}: {
  name: string;
  candidateTenants?: TenantSource;
}): SystemMigration {
  return {
    name,
    title: name,
    description: name,
    requiresOperatorConfirmation: false,
    runsAutomaticallyOnSelfHosted: true,
    enrolledAutomatically: true,
    ...(candidateTenants ? { candidateTenants } : {}),
    async migrateTenant(): Promise<TenantMigrationOutcome> {
      return { status: "finalized" };
    },
  };
}

function driveOrder(buckets: ReturnType<typeof groupByTenantSource>): string[] {
  return buckets.flatMap((bucket) => bucket.migrations.map((migration) => migration.name));
}

describe("groupByTenantSource", () => {
  describe("given one migration declares its own candidates and another does not", () => {
    const drifted = source(["user-drifted"]);
    const everyTenant = source(["user-a", "user-b", "user-drifted"]);
    const heal = migration({ name: "heal", candidateTenants: drifted });
    const backfill = migration({ name: "backfill" });

    /** @scenario "A migration's own candidate tenants do not narrow the others in the pass" */
    it("drives the declaring migration over its own candidates alone", () => {
      const grouped = groupByTenantSource({
        migrations: [backfill, heal],
        everyTenant,
      });

      expect(grouped).toContainEqual({
        tenants: drifted,
        migrations: [heal],
      });
    });

    /** @scenario "A migration's own candidate tenants do not narrow the others in the pass" */
    it("leaves the other migration on every tenant", () => {
      const grouped = groupByTenantSource({
        migrations: [backfill, heal],
        everyTenant,
      });

      expect(grouped).toContainEqual({
        tenants: everyTenant,
        migrations: [backfill],
      });
    });

    it("keeps the two on separate runners", () => {
      const grouped = groupByTenantSource({
        migrations: [backfill, heal],
        everyTenant,
      });

      expect(grouped).toHaveLength(2);
    });
  });

  describe("when no migration declares candidates", () => {
    it("puts them all on the pass's own source, in registration order", () => {
      const everyTenant = source(["user-a"]);
      const first = migration({ name: "first" });
      const second = migration({ name: "second" });

      const grouped = groupByTenantSource({
        migrations: [first, second],
        everyTenant,
      });

      expect(grouped).toEqual([{ tenants: everyTenant, migrations: [first, second] }]);
    });
  });

  describe("when two migrations share one declared source", () => {
    it("drives them together on a single runner", () => {
      const shared = source(["user-drifted"]);
      const everyTenant = source(["user-a"]);
      const one = migration({ name: "one", candidateTenants: shared });
      const two = migration({ name: "two", candidateTenants: shared });

      const grouped = groupByTenantSource({
        migrations: [one, two],
        everyTenant,
      });

      expect(grouped).toEqual([{ tenants: shared, migrations: [one, two] }]);
    });
  });

  describe("when a source is registered again after a different one", () => {
    const shared = source(["user-drifted"]);
    const everyTenant = source(["user-a"]);
    const first = migration({ name: "first", candidateTenants: shared });
    const second = migration({ name: "second" });
    const third = migration({ name: "third", candidateTenants: shared });

    it("keeps registration order rather than merging the two runs", () => {
      const grouped = groupByTenantSource({
        migrations: [first, second, third],
        everyTenant,
      });

      // Merged into one bucket per source this would read first, third,
      // second — third overtaking a migration it was registered after.
      expect(driveOrder(grouped)).toEqual(["first", "second", "third"]);
    });

    it("pages the repeated source once per run", () => {
      const grouped = groupByTenantSource({
        migrations: [first, second, third],
        everyTenant,
      });

      expect(grouped.map((bucket) => bucket.tenants)).toEqual([shared, everyTenant, shared]);
    });
  });
});
