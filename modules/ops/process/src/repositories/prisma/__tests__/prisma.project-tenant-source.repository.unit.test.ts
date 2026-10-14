import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { describe, expect, it } from "vitest";

import { ProjectHasNoOrganizationError } from "../../tenant-source.repository.ts";
import { PrismaProjectTenantSourceRepository } from "../prisma.project-tenant-source.repository.ts";

type ProjectRow = { id: string; teamId: string };
type TeamRow = { id: string; organizationId: string };

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

/** The `where.id` a query asks for: one id, or the ids of an `in` filter. */
function idsAsked(args: unknown): unknown[] {
  const id = field(field(args, "where"), "id");
  const ids = field(id, "in");
  return Array.isArray(ids) ? ids : [id];
}

function repositoryOver({ projects, teams }: { projects: ProjectRow[]; teams: TeamRow[] }) {
  const prisma = prismaDouble({
    project: {
      findMany: async (args: unknown) => projects.filter((row) => idsAsked(args).includes(row.id)),
      findUniqueOrThrow: async (args: unknown) => {
        const row = projects.find((one) => idsAsked(args).includes(one.id));
        if (!row) throw new Error("not found");
        return row;
      },
    },
    team: {
      findMany: async (args: unknown) => teams.filter((row) => idsAsked(args).includes(row.id)),
      findUnique: async (args: unknown) =>
        teams.find((one) => idsAsked(args).includes(one.id)) ?? null,
    },
  });
  return PrismaProjectTenantSourceRepository.create(prisma);
}

describe("the project tenant source", () => {
  describe("when a project's team row is gone", () => {
    const rows = {
      projects: [
        { id: "project_ok", teamId: "team_1" },
        { id: "project_orphan", teamId: "team_gone" },
      ],
      teams: [{ id: "team_1", organizationId: "org_1" }],
    };

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
