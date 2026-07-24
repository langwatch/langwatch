import { describe, it, expect, vi } from "vitest";
import { ProjectRepository } from "../project.repository";
import type { PrismaClient } from "@prisma/client";

function makeMockPrisma(findUniqueResult: unknown = null) {
  return {
    project: {
      findUnique: vi.fn(() => Promise.resolve(findUniqueResult)),
    },
  } as unknown as PrismaClient;
}

describe("ProjectRepository", () => {
  describe("getOrganizationId()", () => {
    describe("when project has an organization", () => {
      it("returns the organizationId", async () => {
        const prisma = makeMockPrisma({
          id: "proj_1",
          team: { organizationId: "org_1", organization: { id: "org_1" } },
        });
        const repository = new ProjectRepository(prisma);

        const result = await repository.getOrganizationId({ projectId: "proj_1" });

        expect(result).toBe("org_1");
      });
    });

    describe("when project does not exist", () => {
      it("returns null", async () => {
        const prisma = makeMockPrisma(null);
        const repository = new ProjectRepository(prisma);

        const result = await repository.getOrganizationId({ projectId: "proj_missing" });

        expect(result).toBeNull();
      });
    });

    describe("when project has no organizationId", () => {
      it("returns null", async () => {
        const prisma = makeMockPrisma({
          id: "proj_1",
          team: { organizationId: null, organization: null },
        });
        const repository = new ProjectRepository(prisma);

        const result = await repository.getOrganizationId({ projectId: "proj_1" });

        expect(result).toBeNull();
      });
    });
  });
});
