import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { AutomationApi } from "@langwatch/automation-contract";
import type { IdentityApi } from "@langwatch/identity-contract";
import { PrismaClient } from "@langwatch/prisma-client/generated";
import { clickhouseRoutesOf } from "@langwatch/process-stores";
import type { SystemMigration } from "@langwatch/system-migrations";
/**
 * @vitest-environment node
 * The migrations console as ops composes it: authz's and identity's registries in main's order,
 * and the cohort exclusion read off the ClickHouse member's routing table.
 * Spec: specs/migration/system-migrations-runner.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MemoryMigrationLeaseRepository } from "../../repositories/memory/memory.migration-lease.repository.ts";
import { MemoryOpsRepositories } from "../../repositories/memory/memory.ops.repositories.ts";
import type { OpsRepositories } from "../../repositories/ops.repositories.ts";
import { PostgresOpsRepositories } from "../../repositories/prisma/prisma.ops.repositories.ts";
import { PrismaSystemMigrationEnrollmentRepository } from "../../repositories/prisma/prisma.system-migration-enrollment.repository.ts";
import { PrismaSystemMigrationStateRepository } from "../../repositories/prisma/prisma.system-migration-state.repository.ts";
import { SystemMigrationCohortService } from "../system-migration-cohort.service.ts";
import { SystemMigrationPassService } from "../system-migration-pass.service.ts";

const migration = (name: string): SystemMigration => ({
  name,
  title: name,
  description: `${name}, as its owner describes it.`,
  requiresOperatorConfirmation: false,
  runsAutomaticallyOnSelfHosted: true,
  enrolledAutomatically: false,
  migrateTenant: async () => ({ status: "finalized" }),
});

function console({
  routes,
  isSaaS = true,
  repositories = {
    ...PostgresOpsRepositories.create({
      prisma: new PrismaClient({ accelerateUrl: "prisma://localhost/test" }),
    }),
    migrationLease: MemoryMigrationLeaseRepository.create(),
  },
}: {
  routes: ReadonlyMap<string, string>;
  isSaaS?: boolean;
  repositories?: OpsRepositories;
}) {
  return SystemMigrationPassService.runner({
    repositories,
    isSaaS: () => isSaaS,
    routes: () => routes,
    dependencies: {
      authz: createApiFixture<AuthzApi>({
        registeredMigrations: () => [migration("authz-grants-genesis-import")],
      }),
      identity: createApiFixture<IdentityApi>({
        registeredMigrations: () => [migration("sso-domain-ownership")],
        userMigrations: () => [],
      }),
      automations: createApiFixture<AutomationApi>({
        registeredMigrations: () => [migration("automations-slack-connections")],
      }),
      auditLog: createApiFixture<AuditLogApi>({
        record: async () => ({ id: "audit", occurredAt: 0 }),
      }),
    },
    passRequests: { request: async () => {} },
  });
}

function cohortPool() {
  const findCohortEligibleOrganizations = vi
    .spyOn(PrismaSystemMigrationEnrollmentRepository.prototype, "findCohortEligibleOrganizations")
    .mockResolvedValue([{ id: "org_shared", name: "Shared" }]);
  vi.spyOn(PrismaSystemMigrationEnrollmentRepository.prototype, "createMany").mockResolvedValue({
    insertedCount: 1,
  });
  return { findCohortEligibleOrganizations };
}

const COHORT = {
  migrationName: "authz-grants-genesis-import",
  sampleSize: 5,
  actorUserId: "user_ops",
  includeEnterprise: false,
  includePrivateDataplane: false,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SystemMigrationPassService.runner", () => {
  describe("given authz and identity each register an organization-rooted migration", () => {
    /** @scenario "The authorization engine's migration runs ahead of identity's, as on main" */
    it("lists authz's grant import first, then identity's D04", async () => {
      vi.spyOn(
        PrismaSystemMigrationStateRepository.prototype,
        "findStatusCounts",
      ).mockResolvedValue({ migrated: 0, finalized: 0, parked: 0, rolled_back: 0 });
      vi.spyOn(
        PrismaSystemMigrationStateRepository.prototype,
        "findRecordsByStatus",
      ).mockResolvedValue([]);

      const overview = await console({ routes: new Map(), isSaaS: false }).getOverview();

      expect(overview.map((migration) => migration.name)).toEqual([
        "authz-grants-genesis-import",
        "sso-domain-ownership",
        "automations-slack-connections",
      ]);
    });
  });

  describe("given the ClickHouse member routes an organization to a private endpoint", () => {
    /** @scenario "A cohort's private-dataplane exclusion is the ClickHouse member's routing table" */
    it("asks the pool to leave that organization out", async () => {
      const { findCohortEligibleOrganizations } = cohortPool();
      const routes = new Map([["org_private", "http://private.clickhouse:8123"]]);

      await console({ routes }).enrollCohort(COHORT);

      expect(findCohortEligibleOrganizations).toHaveBeenCalledWith(
        expect.objectContaining({ excludeOrganizationIds: ["org_private"] }),
      );
    });
  });

  describe("given a deployment with no private routes", () => {
    /** @scenario "A cohort on a deployment with no private data planes excludes nobody" */
    it("samples the whole pool rather than refusing", async () => {
      const { findCohortEligibleOrganizations } = cohortPool();

      await expect(console({ routes: new Map() }).enrollCohort(COHORT)).resolves.toMatchObject({
        eligibleCount: 1,
      });
      expect(findCohortEligibleOrganizations).toHaveBeenCalledWith(
        expect.objectContaining({ excludeOrganizationIds: [] }),
      );
    });
  });

  describe("given CLICKHOUSE_URL__acme__org_1 names an organization's own server", () => {
    /** @scenario "The migration runner reads the clickhouse member's routes" */
    it("resolves org_1 as private and every other organization as shared", async () => {
      const endpoint = "http://private.clickhouse:8123";
      const family = new Map([["CLICKHOUSE_URL__acme__org_1", endpoint]]);
      const routes = new Map(
        clickhouseRoutesOf(family).map((route) => [route.organizationId, route.url]),
      );
      const repositories = MemoryOpsRepositories.create();
      vi.spyOn(repositories.migrationEnrollments, "getOrganizationById").mockImplementation(
        async ({ organizationId }) => ({ id: organizationId, name: organizationId }),
      );
      const admits = vi.spyOn(SystemMigrationCohortService.prototype, "admits");
      const runner = console({ routes, isSaaS: false, repositories });

      for (const organizationId of ["org_1", "org_2"]) {
        await runner.runForOrganization({
          organizationId,
          migrationName: "authz-grants-genesis-import",
          actorUserId: "user_ops",
        });
      }

      expect(admits.mock.results.map((result) => result.value.dataplane)).toEqual([
        { kind: "private", endpoint },
        { kind: "shared" },
      ]);
    });
  });
});
