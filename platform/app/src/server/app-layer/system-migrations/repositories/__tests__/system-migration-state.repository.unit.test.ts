import { describe, expect, it, vi } from "vitest";
import { Prisma } from "~/generated/prisma/client";
import { PrismaSystemMigrationStateRepository } from "../system-migration-state.prisma.repository";

function knownRequestError(code: string) {
  return new Prisma.PrismaClientKnownRequestError("conflict", {
    code,
    clientVersion: "test",
  });
}

function repositoryWith(overrides: {
  systemMigrationTenantState?: Partial<
    Record<string, ReturnType<typeof vi.fn>>
  >;
}) {
  const prisma = {
    systemMigrationTenantState: {
      update: vi.fn().mockResolvedValue(undefined),
      create: vi.fn().mockResolvedValue(undefined),
      ...overrides.systemMigrationTenantState,
    },
  };
  return {
    prisma,
    repository: new PrismaSystemMigrationStateRepository(prisma as never),
  };
}

const record = {
  migrationName: "example_migration",
  tenantId: "tenant_acme",
  status: "finalized" as const,
  report: null,
};

describe("PrismaSystemMigrationStateRepository", () => {
  describe("when the pass writes over a tenant with no pin", () => {
    it("issues a single guarded update keyed on the compound unique", async () => {
      const { repository, prisma } = repositoryWith({});

      const wrote = await repository.upsertRecordUnlessRolledBack(record);

      expect(wrote).toBe(true);
      expect(prisma.systemMigrationTenantState.update).toHaveBeenCalledWith({
        where: {
          migrationName_tenantId: {
            migrationName: "example_migration",
            tenantId: "tenant_acme",
          },
          NOT: { status: "rolled_back" },
        },
        data: expect.objectContaining({ status: "finalized" }),
      });
      expect(prisma.systemMigrationTenantState.create).not.toHaveBeenCalled();
    });
  });

  describe("when no row exists yet for the tenant", () => {
    /** @scenario "A pass writes the first record for a tenant" */
    it("creates the row after the guarded update matches nothing", async () => {
      const { repository, prisma } = repositoryWith({
        systemMigrationTenantState: {
          update: vi.fn().mockRejectedValue(knownRequestError("P2025")),
        },
      });

      const wrote = await repository.upsertRecordUnlessRolledBack(record);

      expect(wrote).toBe(true);
      expect(prisma.systemMigrationTenantState.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          migrationName: "example_migration",
          tenantId: "tenant_acme",
          status: "finalized",
        }),
      });
    });
  });

  describe("given an operator pinned the tenant to rolled_back", () => {
    /** @scenario "A migration pass never overwrites an operator's rollback pin" */
    it("refuses the write when the guarded update matches nothing and the row already exists", async () => {
      const { repository, prisma } = repositoryWith({
        systemMigrationTenantState: {
          update: vi.fn().mockRejectedValue(knownRequestError("P2025")),
          create: vi.fn().mockRejectedValue(knownRequestError("P2002")),
        },
      });

      const wrote = await repository.upsertRecordUnlessRolledBack(record);

      expect(wrote).toBe(false);
    });

    it("never uses updateMany, which Prisma 7 would split into a SELECT then an unguarded UPDATE", async () => {
      const { repository, prisma } = repositoryWith({
        systemMigrationTenantState: {
          updateMany: vi.fn(),
        },
      });

      await repository.upsertRecordUnlessRolledBack(record);

      expect(
        prisma.systemMigrationTenantState.updateMany,
      ).not.toHaveBeenCalled();
    });
  });

  describe("when storage fails for an unrelated reason", () => {
    it("lets the error escape instead of treating it as a lost pin", async () => {
      const { repository } = repositoryWith({
        systemMigrationTenantState: {
          update: vi.fn().mockRejectedValue(new Error("connection reset")),
        },
      });

      await expect(
        repository.upsertRecordUnlessRolledBack(record),
      ).rejects.toThrow("connection reset");
    });
  });
});
