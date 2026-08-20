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
      create: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      ...overrides.enrollment,
    },
    organization: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
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
  describe("given an organization already enrolled for a stage", () => {
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
          stage: "migrations",
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
            stage: "migrations",
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
          repository.delete({ organizationId: "org_globex", stage: "cutover" }),
        ).rejects.toMatchObject({ code: "migration_enrollment_not_found" });
      });
    });
  });

  describe("when one stage's enrollments are listed", () => {
    it("resolves organization and enroller names, tolerating both being gone", async () => {
      const createdAt = new Date("2026-08-19T10:00:00Z");
      const { repository, prisma } = repositoryWith({
        enrollment: {
          findMany: vi.fn().mockResolvedValue([
            {
              organizationId: "org_acme",
              stage: "migrations",
              enrolledByUserId: "user_alex",
              createdAt,
            },
            {
              organizationId: "org_deleted",
              stage: "migrations",
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

      const listed = await repository.findAllByStage({ stage: "migrations" });

      expect(listed).toEqual([
        {
          organizationId: "org_acme",
          organizationName: "Acme",
          stage: "migrations",
          enrolledByUserId: "user_alex",
          enrolledByLabel: "Alex",
          createdAt,
        },
        {
          organizationId: "org_deleted",
          organizationName: null,
          stage: "migrations",
          enrolledByUserId: "user_gone",
          enrolledByLabel: null,
          createdAt,
        },
      ]);
      expect(prisma.systemMigrationEnrollment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { stage: "migrations" } }),
      );
    });
  });

  describe("when the pass asks for the enrolled set", () => {
    it("answers one stage's organization ids as a set", async () => {
      const { repository } = repositoryWith({
        enrollment: {
          findMany: vi
            .fn()
            .mockResolvedValue([
              { organizationId: "org_acme" },
              { organizationId: "org_globex" },
            ]),
        },
      });

      const enrolled = await repository.findEnrolledOrganizationIds({
        stage: "migrations",
      });

      expect(enrolled).toEqual(new Set(["org_acme", "org_globex"]));
    });
  });
});
