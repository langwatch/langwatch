import { describe, expect, it, vi } from "vitest";
import { Prisma } from "~/generated/prisma/client";
import { PrismaSystemMigrationEnrollmentRepository } from "../system-migration-enrollment.prisma.repository";

function knownRequestError(code: string) {
  return new Prisma.PrismaClientKnownRequestError("conflict", {
    code,
    clientVersion: "test",
  });
}

function repositoryWith(overrides: {
  enrollment?: Partial<Record<string, ReturnType<typeof vi.fn>>>;
  organization?: Partial<Record<string, ReturnType<typeof vi.fn>>>;
  user?: Partial<Record<string, ReturnType<typeof vi.fn>>>;
}) {
  const prisma = {
    systemMigrationEnrollment: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      groupBy: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      ...overrides.enrollment,
    },
    organization: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(0),
      ...overrides.organization,
    },
    user: {
      findMany: vi.fn().mockResolvedValue([]),
      ...overrides.user,
    },
  };
  return {
    prisma,
    repository: new PrismaSystemMigrationEnrollmentRepository(prisma as never),
  };
}

describe("PrismaSystemMigrationEnrollmentRepository", () => {
  describe("given an organization already enrolled for a migration", () => {
    describe("when the same enrollment is created again", () => {
      /** @scenario "Enrolling an organization twice is refused" */
      it("refuses with migration_enrollment_already_exists and writes nothing new", async () => {
        const { repository } = repositoryWith({
          enrollment: {
            create: vi.fn().mockRejectedValue(knownRequestError("P2002")),
          },
        });

        const attempt = repository.create({
          organizationId: "org_acme",
          migrationName: "authz-team-user-backfill",
          enrolledByUserId: "user_alex",
        });

        await expect(attempt).rejects.toMatchObject({
          code: "migration_enrollment_already_exists",
        });
      });

      it("lets any other storage failure escape as a plain error", async () => {
        const { repository } = repositoryWith({
          enrollment: {
            create: vi.fn().mockRejectedValue(new Error("connection reset")),
          },
        });

        await expect(
          repository.create({
            organizationId: "org_acme",
            migrationName: "authz-team-user-backfill",
            enrolledByUserId: "user_alex",
          }),
        ).rejects.toThrow("connection reset");
      });
    });
  });

  describe("given an organization that is not enrolled", () => {
    describe("when its enrollment is withdrawn", () => {
      /** @scenario "Withdrawing an organization that is not enrolled is refused" */
      it("refuses with migration_enrollment_not_found", async () => {
        const { repository } = repositoryWith({
          enrollment: {
            delete: vi.fn().mockRejectedValue(knownRequestError("P2025")),
          },
        });

        await expect(
          repository.delete({
            organizationId: "org_globex",
            migrationName: "authz-grants-cutover",
          }),
        ).rejects.toMatchObject({ code: "migration_enrollment_not_found" });
      });
    });
  });

  describe("when the enrollments are listed", () => {
    it("resolves organization and enroller names, tolerating both being gone", async () => {
      const createdAt = new Date("2026-08-19T10:00:00Z");
      const { repository } = repositoryWith({
        enrollment: {
          findMany: vi.fn().mockResolvedValue([
            {
              organizationId: "org_acme",
              migrationName: "authz-team-user-backfill",
              enrolledByUserId: "user_alex",
              createdAt,
            },
            {
              organizationId: "org_deleted",
              migrationName: "authz-grants-cutover",
              enrolledByUserId: "user_gone",
              createdAt,
            },
          ]),
        },
        organization: {
          findMany: vi
            .fn()
            .mockResolvedValue([{ id: "org_acme", name: "Acme" }]),
        },
        user: {
          findMany: vi
            .fn()
            .mockResolvedValue([{ id: "user_alex", name: "Alex" }]),
        },
      });

      const listed = await repository.findAll();

      expect(listed).toEqual([
        {
          organizationId: "org_acme",
          organizationName: "Acme",
          migrationName: "authz-team-user-backfill",
          enrolledByUserId: "user_alex",
          enrolledByLabel: "Alex",
          createdAt,
        },
        {
          organizationId: "org_deleted",
          organizationName: null,
          migrationName: "authz-grants-cutover",
          enrolledByUserId: "user_gone",
          enrolledByLabel: null,
          createdAt,
        },
      ]);
    });
  });

  describe("when the pass asks for the enrolled sets", () => {
    it("answers organization ids grouped by migration name", async () => {
      const { repository } = repositoryWith({
        enrollment: {
          findMany: vi.fn().mockResolvedValue([
            {
              organizationId: "org_acme",
              migrationName: "authz-team-user-backfill",
            },
            {
              organizationId: "org_globex",
              migrationName: "authz-team-user-backfill",
            },
            {
              organizationId: "org_acme",
              migrationName: "authz-grants-cutover",
            },
          ]),
        },
      });

      const enrolled =
        await repository.findEnrolledOrganizationIdsByMigration();

      expect(enrolled).toEqual(
        new Map([
          ["authz-team-user-backfill", new Set(["org_acme", "org_globex"])],
          ["authz-grants-cutover", new Set(["org_acme"])],
        ]),
      );
    });
  });

  describe("when the page asks for the enrollment gauge", () => {
    /** @scenario "The page shows how many organizations each migration could still enroll" */
    it("answers enrolled counts per migration", async () => {
      const { repository } = repositoryWith({
        enrollment: {
          groupBy: vi.fn().mockResolvedValue([
            {
              migrationName: "authz-team-user-backfill",
              _count: { organizationId: 2 },
            },
          ]),
        },
      });

      const counts = await repository.countEnrolledByMigration();

      expect(counts).toEqual(new Map([["authz-team-user-backfill", 2]]));
    });
  });

  describe("when an operator searches organizations", () => {
    /** @scenario "An operator finds an organization by name to act on it" */
    it("matches by name fragment or exact id, a short list", async () => {
      const findMany = vi
        .fn()
        .mockResolvedValue([{ id: "org_acme", name: "Acme Corporation" }]);
      const { repository } = repositoryWith({
        organization: { findMany },
      });

      const found = await repository.searchOrganizations({ query: "acme" });

      expect(found).toEqual([{ id: "org_acme", name: "Acme Corporation" }]);
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              { name: { contains: "acme", mode: "insensitive" } },
              { id: "acme" },
            ],
          },
          take: 10,
        }),
      );
    });
  });
});
