import { describe, expect, it } from "vitest";
import { groupByTenantSource } from "../grouping";
import type { SystemMigration } from "../system-migration";
import type { TenantSource } from "../tenant-source";
import type { TenantMigrationOutcome } from "../types";

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

      expect(grouped.get(drifted)).toEqual([heal]);
    });

    /** @scenario "A migration's own candidate tenants do not narrow the others in the pass" */
    it("leaves the other migration on every tenant", () => {
      const grouped = groupByTenantSource({
        migrations: [backfill, heal],
        everyTenant,
      });

      expect(grouped.get(everyTenant)).toEqual([backfill]);
    });

    it("keeps the two on separate runners", () => {
      const grouped = groupByTenantSource({
        migrations: [backfill, heal],
        everyTenant,
      });

      expect(grouped.size).toBe(2);
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

      expect([...grouped.keys()]).toEqual([everyTenant]);
      expect(grouped.get(everyTenant)).toEqual([first, second]);
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

      expect(grouped.size).toBe(1);
      expect(grouped.get(shared)).toEqual([one, two]);
    });
  });
});
