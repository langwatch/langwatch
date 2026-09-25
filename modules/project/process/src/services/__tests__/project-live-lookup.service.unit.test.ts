import { createApiFixture } from "@langwatch/api-fixture";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { fromDate } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemoryProjectDatabase } from "../../repositories/memory/memory.project.database.ts";
import { MemoryProjectRepository } from "../../repositories/memory/memory.project.repository.ts";
import { ProjectCredentialsService } from "../project-credentials.service.ts";
import { ProjectService } from "../project.service.ts";

const ORGANIZATION_ID = "organization_1";
const OTHER_ORGANIZATION_ID = "organization_2";

function team({ id, organizationId }: { id: string; organizationId: string }) {
  return {
    id,
    name: id,
    slug: id,
    organizationId,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    archivedAt: null,
    isPersonal: false,
    ownerUserId: null,
    departmentId: null,
  };
}

function project({ id, slug, teamId }: { id: string; slug: string; teamId: string }) {
  return {
    id,
    slug,
    teamId,
    name: id,
    apiKey: `sk-${id}`,
    language: "python",
    framework: "openai",
  };
}

async function seeded() {
  const database = MemoryProjectDatabase.create();
  for (const organizationId of [ORGANIZATION_ID, OTHER_ORGANIZATION_ID]) {
    database.putOrganization({
      id: organizationId,
      name: organizationId,
      presenceEnabled: true,
      traceSharingEnabled: true,
      adminUserIds: [],
      onboardingVariant: null,
      createdAt: fromDate(new Date("2026-01-01T00:00:00.000Z")),
    });
  }
  database.putTeam(team({ id: "team_1", organizationId: ORGANIZATION_ID }));
  database.putTeam(team({ id: "team_2", organizationId: OTHER_ORGANIZATION_ID }));
  const repository = MemoryProjectRepository.create({ memory: database });
  await repository.create(project({ id: "project_1", slug: "checkout", teamId: "team_1" }));
  await repository.create(project({ id: "project_old", slug: "old", teamId: "team_1" }));
  await repository.archive({ id: "project_old", organizationId: ORGANIZATION_ID });
  await repository.create(
    project({ id: "project_elsewhere", slug: "elsewhere", teamId: "team_2" }),
  );

  return ProjectService.create({
    repository,
    credentials: ProjectCredentialsService.create(),
    organizations: createApiFixture<OrganizationApi>({}),
  });
}

describe("ProjectService live lookups", () => {
  describe("when a project is looked up by slug", () => {
    it("finds the live project in the caller's organization", async () => {
      const service = await seeded();

      const found = await service.findLiveBySlug({
        slug: "checkout",
        organizationId: ORGANIZATION_ID,
      });

      expect(found.map(({ id, apiKey }) => ({ id, apiKey }))).toEqual([
        { id: "project_1", apiKey: "sk-project_1" },
      ]);
    });

    it("finds nothing for an archived project or one in another organization", async () => {
      const service = await seeded();

      expect(
        await service.findLiveBySlug({ slug: "old", organizationId: ORGANIZATION_ID }),
      ).toEqual([]);
      expect(
        await service.findLiveBySlug({ slug: "elsewhere", organizationId: ORGANIZATION_ID }),
      ).toEqual([]);
    });
  });

  describe("when a project is looked up by reference", () => {
    it("reads the reference as an id first, then as a slug", async () => {
      const service = await seeded();

      const byId = await service.findLiveByRef({
        projectRef: "project_1",
        organizationId: ORGANIZATION_ID,
      });
      const bySlug = await service.findLiveByRef({
        projectRef: "checkout",
        organizationId: ORGANIZATION_ID,
      });

      expect(byId.map(({ id }) => id)).toEqual(["project_1"]);
      expect(bySlug.map(({ id }) => id)).toEqual(["project_1"]);
    });

    it("finds nothing across organizations, by id or by slug", async () => {
      const service = await seeded();

      expect(
        await service.findLiveByRef({
          projectRef: "project_elsewhere",
          organizationId: ORGANIZATION_ID,
        }),
      ).toEqual([]);
      expect(
        await service.findLiveByRef({ projectRef: "elsewhere", organizationId: ORGANIZATION_ID }),
      ).toEqual([]);
    });
  });
});
