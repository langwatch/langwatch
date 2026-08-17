import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";
import { PrismaAuthzGrantsProjectionRepository } from "../authz-grants-projection.prisma.repository";

function makePrisma() {
  return {
    grant: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    roleBinding: { deleteMany: vi.fn(async () => ({ count: 0 })) },
  } as unknown as PrismaClient;
}

describe("PrismaAuthzGrantsProjectionRepository", () => {
  describe("when a revocation is enforced on the calling path", () => {
    it("deletes both heads keyed by organization and the named grant ids only", async () => {
      const prisma = makePrisma();
      const repository = new PrismaAuthzGrantsProjectionRepository(prisma);

      await repository.enforceGrantRevocation({
        organizationId: "org_1",
        grantIds: ["grant_a", "grant_b"],
      });

      const scoped = {
        where: { organizationId: "org_1", id: { in: ["grant_a", "grant_b"] } },
      };
      expect(prisma.grant.deleteMany).toHaveBeenCalledWith(scoped);
      // Compat rows share the grant id, so a legacy-authored binding can
      // never be collateral - its id is not a grant id.
      expect(prisma.roleBinding.deleteMany).toHaveBeenCalledWith(scoped);
    });
  });

  describe("when the revocation names no grants", () => {
    it("touches nothing", async () => {
      const prisma = makePrisma();
      const repository = new PrismaAuthzGrantsProjectionRepository(prisma);

      await repository.enforceGrantRevocation({
        organizationId: "org_1",
        grantIds: [],
      });

      expect(prisma.grant.deleteMany).not.toHaveBeenCalled();
      expect(prisma.roleBinding.deleteMany).not.toHaveBeenCalled();
    });
  });
});
