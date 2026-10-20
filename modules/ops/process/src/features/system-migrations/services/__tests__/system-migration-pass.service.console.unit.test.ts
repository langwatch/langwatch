import type { AuditLogApi } from "@langwatch/audit-log-contract";
import { InMemoryProcessStore } from "@langwatch/eventing";
import type { IdentityApi } from "@langwatch/identity-contract";
import { PrismaClient } from "@langwatch/prisma-client/generated";
import { clickhouseRoutesOf } from "@langwatch/process-stores";
/**
 * @vitest-environment node
 * The migrations console as ops composes it: the declared tenant steps in installation order,
 * and the cohort exclusion read off the ClickHouse member's routing table.
 * Spec: specs/migration/system-migrations-runner.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { defineMigrationStep } from "@langwatch/upgrade/step";
import { MemoryTenantStepStateRepository } from "@langwatch/upgrade/step/tenant-state";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MemoryMigrationLeaseRepository } from "../../../../repositories/memory/memory.migration-lease.repository.ts";
import { MemoryOpsRepositories } from "../../../../repositories/memory/memory.ops.repositories.ts";
import { PostgresOpsRepositories } from "../../../../repositories/prisma/prisma.ops.repositories.ts";
import { PrismaSystemMigrationEnrollmentRepository } from "../../../../repositories/prisma/prisma.system-migration-enrollment.repository.ts";
import { NullQueueRepository } from "../../../../repositories/queue.repository.ts";
import { SystemMigrationCohortService } from "../system-migration-cohort.service.ts";
import {
  SystemMigrationPassService,
  type SystemMigrationPassRepositories,
} from "../system-migration-pass.service.ts";

const step = (id: string, tenants: "organization" | "user" | "project" = "organization") =>
  defineMigrationStep({
    id,
    kind: "tenant",
    mode: "background",
    tenants,
    title: `${id} title`,
    description: `${id}, as its owner describes it.`,
    requiresOperatorConfirmation: false,
    runsAutomaticallyOnSelfHosted: true,
    enrolledAutomatically: false,
    migrateTenant: async () => ({ status: "finalized" }),
  });

/** Installation order: authz installs ahead of identity, as main's registry listed them. */
const STEPS = [
  step("authz:engine"),
  step("identity:sso-domain-ownership-backfill"),
  step("identity:identifier-backfill", "user"),
  step("stored-object:import-from-clickhouse", "project"),
];

function console({
  routes,
  isSaaS = true,
  repositories = {
    ...PostgresOpsRepositories.create({
      prisma: new PrismaClient({ accelerateUrl: "prisma://localhost/test" }),
    }),
    migrationLease: MemoryMigrationLeaseRepository.create(),
    queues: NullQueueRepository.create(),
  },
}: {
  routes: ReadonlyMap<string, string>;
  isSaaS?: boolean;
  repositories?: SystemMigrationPassRepositories;
}) {
  return SystemMigrationPassService.runner({
    repositories,
    isSaaS: () => isSaaS,
    routes: () => routes,
    declared: {
      steps: () => STEPS,
      state: MemoryTenantStepStateRepository.create(),
      settle: { settle: async () => [] },
    },
    dependencies: {
      identity: createApiFixture<IdentityApi>({}),
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
  migrationName: "authz:engine",
  sampleSize: 5,
  actorUserId: "user_ops",
  includeEnterprise: false,
  includePrivateDataplane: false,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SystemMigrationPassService.runner", () => {
  describe("given authz and identity each declare an organization step", () => {
    /** @scenario "The authorization engine's migration runs ahead of identity's, as on main" */
    it("lists authz's engine step first, then identity's", async () => {
      const overview = await console({ routes: new Map(), isSaaS: false }).getOverview();

      expect(overview.map((migration) => migration.name).slice(0, 2)).toEqual([
        "authz:engine",
        "identity:sso-domain-ownership-backfill",
      ]);
    });
  });

  describe("given installed modules declare organization, user and project steps", () => {
    /** @scenario "The tenant migrations tab lists every registered migration when served by the api role" */
    /** @scenario "A migration registered by a peer module appears on the page with its title and description" */
    it("lists each organization and user step with its owner's title, description and axis", async () => {
      const overview = await console({ routes: new Map(), isSaaS: false }).getOverview();

      expect(
        overview.map(({ name, title, description, tenant }) => ({
          name,
          title,
          description,
          tenant,
        })),
      ).toEqual(
        [
          "authz:engine",
          "identity:sso-domain-ownership-backfill",
          "identity:identifier-backfill",
        ].map((name) => ({
          name,
          title: `${name} title`,
          description: `${name}, as its owner describes it.`,
          tenant: name === "identity:identifier-backfill" ? "user" : "organization",
        })),
      );
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
      const repositories = MemoryOpsRepositories.create({
        eventing: { definitions: [] },
        processStore: InMemoryProcessStore.createForTesting(),
      });
      vi.spyOn(repositories.migrationEnrollments, "getOrganizationById").mockImplementation(
        async ({ organizationId }) => ({ id: organizationId, name: organizationId }),
      );
      const admits = vi.spyOn(SystemMigrationCohortService.prototype, "admits");
      const runner = console({ routes, isSaaS: false, repositories });

      for (const organizationId of ["org_1", "org_2"]) {
        await runner.runForOrganization({
          organizationId,
          migrationName: "authz:engine",
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
