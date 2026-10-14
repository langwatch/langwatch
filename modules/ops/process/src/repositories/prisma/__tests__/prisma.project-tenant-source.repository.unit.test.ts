import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { describe, expect, it } from "vitest";

import { ProjectHasNoOrganizationError } from "../../tenant-source.repository.ts";
import { PrismaProjectTenantSourceRepository } from "../prisma.project-tenant-source.repository.ts";

type ProjectRow = { id: string; team: { organizationId: string } | null };

function repositoryOver(rows: ProjectRow[]) {
  const prisma = {
    project: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
        rows.filter((row) => where.id.in.includes(row.id)),
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        const row = rows.find((one) => one.id === where.id);
        if (!row) throw new Error("not found");
        return row;
      },
    },
  } as unknown as PrismaClient;
  return PrismaProjectTenantSourceRepository.create(prisma);
}

describe("the project tenant source", () => {
  describe("when a project's team row is gone", () => {
    const rows: ProjectRow[] = [
      { id: "project_ok", team: { organizationId: "org_1" } },
      { id: "project_orphan", team: null },
    ];

    it("leaves the orphan out of the owning organizations instead of crashing", async () => {
      await expect(
        repositoryOver(rows).findOrganizationIds({
          projectIds: ["project_ok", "project_orphan"],
        }),
      ).resolves.toEqual([{ projectId: "project_ok", organizationId: "org_1" }]);
    });

    it("names the orphan when its organization is asked for directly", async () => {
      await expect(repositoryOver(rows).getOrganizationId("project_orphan")).rejects.toBeInstanceOf(
        ProjectHasNoOrganizationError,
      );
      await expect(repositoryOver(rows).getOrganizationId("project_ok")).resolves.toBe("org_1");
    });
  });
});
