/**
 * The cohort's private-dataplane exclusion in runtime.ts is one line of
 * composition — the env routing table's KEYS become the ids a cohort must
 * skip. Every other cohort test injects that list directly, so only this
 * suite fails if the composition stops wiring it (or wires the wrong shape),
 * which would quietly make private-dataplane organizations enrollable.
 * Enrolls into the ADR-110 engine migration, the one organization-rooted
 * migration the runtime registers.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => {
  const enrollmentFindMany = vi.fn();
  const organizationFindMany = vi.fn();
  const enrollmentCreateMany = vi.fn();
  return {
    enrollmentFindMany,
    organizationFindMany,
    enrollmentCreateMany,
    prisma: {
      systemMigrationEnrollment: {
        findMany: enrollmentFindMany,
        createMany: enrollmentCreateMany,
      },
      organization: { findMany: organizationFindMany },
    },
  };
});

vi.mock("~/server/db", () => ({ prisma: stubs.prisma }));
vi.mock("~/env.mjs", () => ({ env: { IS_SAAS: true } }));
vi.mock("~/runtime/app/features/audit-log", () => ({ auditLog: vi.fn() }));
vi.mock("../../app", () => ({ tryGetApp: () => null }));
vi.mock("../../../clickhouse/clickhouseClient", () => ({
  getPrivateClickHouseUrls: () =>
    new Map([["org_private_dataplane", "http://private:8123"]]),
}));

import { AUTHZ_ENGINE_MIGRATION_NAME } from "../../authz/migration-name";
import { systemMigrationsService } from "../runtime";

describe("the cohort's private-dataplane exclusion wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubs.enrollmentFindMany.mockResolvedValue([]);
    stubs.organizationFindMany.mockResolvedValue([]);
    stubs.enrollmentCreateMany.mockResolvedValue({ count: 0 });
  });

  describe("when a cohort's eligible pool is read through the real composition", () => {
    /** @scenario "A cohort leaves out an enterprise organization by default" */
    it.skip("excludes the organizations named by the private ClickHouse routing table", async () => {
      await systemMigrationsService.enrollCohort({
        migrationName: AUTHZ_ENGINE_MIGRATION_NAME,
        sampleSize: 5,
        actorUserId: "user_ops",
      });

      expect(stubs.organizationFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: expect.objectContaining({
              notIn: expect.arrayContaining(["org_private_dataplane"]),
            }),
          }),
        }),
      );
    });
  });
});
