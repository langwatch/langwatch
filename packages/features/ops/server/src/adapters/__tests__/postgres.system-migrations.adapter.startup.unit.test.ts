import { PrismaClient } from "@langwatch/prisma-client/generated";
import { PrismaDriverAdapterService } from "@langwatch/prisma-client";
import type { TenantMigrationRecord, SystemMigration } from "@langwatch/system-migrations";
import { SystemMigrationStartupIncompleteError } from "@langwatch/system-migrations";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PrismaSystemMigrationEnrollmentRepository } from "../../repositories/prisma/prisma.system-migration-enrollment.repository.ts";
import { PrismaOrganizationTenantSourceRepository } from "../../repositories/prisma/prisma.organization-tenant-source.repository.ts";
import { PrismaSystemMigrationStateRepository } from "../../repositories/prisma/prisma.system-migration-state.repository.ts";
import { RedisMigrationLeaseRepository } from "../../repositories/redis/redis.migration-lease.repository.ts";
import {
  PostgresSystemMigrationsAdapter,
  UserStartupMigrationsUnsupportedError,
} from "../postgres.system-migrations.adapter.ts";

const clients: PrismaClient[] = [];

function migrationOf(
  name: string,
  executionMode: "background" | "startup" = "startup",
  enrolledAutomatically = true,
  migrateTenant: SystemMigration["migrateTenant"] = async () => ({
    status: "finalized",
  }),
): SystemMigration {
  return {
    name,
    title: name,
    description: name,
    requiresOperatorConfirmation: false,
    runsAutomaticallyOnSelfHosted: false,
    enrolledAutomatically,
    executionMode,
    migrateTenant,
  };
}

function harness({
  tenants,
  enrollments = new Map(),
  records = new Map(),
}: {
  tenants: string[];
  enrollments?: Map<string, Set<string>>;
  records?: Map<string, TenantMigrationRecord>;
}) {
  const database = new PrismaClient({
    adapter: PrismaDriverAdapterService.create().createOwnedAdapter(
      "postgresql://unused:unused@localhost:1/test",
    ),
  });
  clients.push(database);
  vi.spyOn(
    PrismaOrganizationTenantSourceRepository.prototype,
    "findTenantIdsAfter",
  ).mockImplementation(async ({ cursor }) => {
    const start = cursor === null ? 0 : tenants.findIndex((tenant) => tenant > cursor);
    return start < 0 ? [] : tenants.slice(start, start + 100);
  });
  vi.spyOn(
    PrismaSystemMigrationEnrollmentRepository.prototype,
    "findEnrolledOrganizationIdsByMigration",
  ).mockResolvedValue(enrollments);
  vi.spyOn(PrismaSystemMigrationStateRepository.prototype, "tryFindRecord").mockImplementation(
    async ({ migrationName, tenantId }) => records.get(`${migrationName}:${tenantId}`) ?? null,
  );
  vi.spyOn(
    PrismaSystemMigrationStateRepository.prototype,
    "upsertRecordUnlessRolledBack",
  ).mockImplementation(async (record) => {
    records.set(`${record.migrationName}:${record.tenantId}`, record);
    return true;
  });
  vi.spyOn(PrismaSystemMigrationStateRepository.prototype, "upsertRecord").mockImplementation(
    async (record) => {
      records.set(`${record.migrationName}:${record.tenantId}`, record);
    },
  );
  vi.spyOn(RedisMigrationLeaseRepository.prototype, "acquire").mockResolvedValue(true);
  vi.spyOn(RedisMigrationLeaseRepository.prototype, "renew").mockResolvedValue(true);
  vi.spyOn(RedisMigrationLeaseRepository.prototype, "release").mockResolvedValue();

  const adapter = PostgresSystemMigrationsAdapter.create({
    database,
    redis: null,
    isSaaS: () => true,
    migrations: () => [],
    userMigrations: () => [],
    newbornSweep: vi.fn(async () => undefined),
  });
  return { adapter, database, records };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(clients.splice(0).map((client) => client.$disconnect()));
});

describe("PostgresSystemMigrationsAdapter.runStartup", () => {
  it("runs startup migrations for enrolled tenants and excludes background migrations and tenants", async () => {
    const startup = migrationOf("stored-object-startup", "startup", false);
    const background = migrationOf("background", "background");
    const startupRun = vi.spyOn(startup, "migrateTenant");
    const backgroundRun = vi.spyOn(background, "migrateTenant");
    const { database } = harness({
      tenants: ["org_acme", "org_globex"],
      enrollments: new Map([[startup.name, new Set(["org_acme"])]]),
    });
    const adapter = PostgresSystemMigrationsAdapter.create({
      database,
      redis: null,
      isSaaS: () => true,
      migrations: () => [startup, background],
      userMigrations: () => [],
      newbornSweep: vi.fn(async () => undefined),
    });

    await adapter.runStartup({ maxPasses: 1, pollDelayMs: 0 });

    expect(startupRun).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "org_acme" }));
    expect(startupRun).toHaveBeenCalledTimes(1);
    expect(backgroundRun).not.toHaveBeenCalled();
  });

  it("blocks pending startup state and allows finalized state", async () => {
    const pending = migrationOf("stored-object-startup", "startup", true, async () => ({
      status: "migrated",
      report: {},
    }));
    const pendingHarness = harness({ tenants: ["org_acme"] });
    const pendingAdapter = PostgresSystemMigrationsAdapter.create({
      database: pendingHarness.database,
      redis: null,
      isSaaS: () => true,
      migrations: () => [pending],
      userMigrations: () => [],
      newbornSweep: vi.fn(async () => undefined),
    });
    await expect(
      pendingAdapter.runStartup({ maxPasses: 1, pollDelayMs: 0 }),
    ).rejects.toBeInstanceOf(SystemMigrationStartupIncompleteError);

    const finalizedHarness = harness({ tenants: ["org_acme"] });
    const finalized = migrationOf("stored-object-startup");
    const finalizedAdapter = PostgresSystemMigrationsAdapter.create({
      database: finalizedHarness.database,
      redis: null,
      isSaaS: () => true,
      migrations: () => [finalized],
      userMigrations: () => [],
      newbornSweep: vi.fn(async () => undefined),
    });
    await expect(
      finalizedAdapter.runStartup({ maxPasses: 1, pollDelayMs: 0 }),
    ).resolves.toBeUndefined();
  });

  it("refuses startup-mode user migrations before starting an organization pass", async () => {
    const userMigration = migrationOf("user-startup");
    const { database } = harness({ tenants: ["org_acme"] });
    const adapter = PostgresSystemMigrationsAdapter.create({
      database,
      redis: null,
      isSaaS: () => true,
      migrations: () => [],
      userMigrations: () => [userMigration],
      newbornSweep: vi.fn(async () => undefined),
    });

    await expect(adapter.runStartup({ maxPasses: 1, pollDelayMs: 0 })).rejects.toEqual(
      expect.objectContaining({
        name: "UserStartupMigrationsUnsupportedError",
        migrationNames: ["user-startup"],
      } satisfies Partial<UserStartupMigrationsUnsupportedError>),
    );
  });
});
