import { ProjectNotFoundError } from "@langwatch/project-contract";
import { fromDate } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemoryProjectStorageSettingsRepository } from "../memory.project-storage-settings.repository.ts";
import { MemoryProjectDatabase } from "../memory.project.database.ts";
import { MemoryProjectRepository } from "../memory.project.repository.ts";

const ORGANIZATION_ID = "organization_1";
const TEAM_ID = "team_1";
const AT = new Date("2026-01-01T00:00:00.000Z");

async function seeded() {
  const database = MemoryProjectDatabase.create();
  database.putOrganization({
    id: ORGANIZATION_ID,
    name: "Acme",
    presenceEnabled: true,
    traceSharingEnabled: true,
    adminUserIds: [],
    onboardingVariant: null,
    createdAt: fromDate(AT),
  });
  database.putTeam({
    id: TEAM_ID,
    name: "Engineering",
    slug: "engineering",
    organizationId: ORGANIZATION_ID,
    createdAt: AT,
    updatedAt: AT,
    archivedAt: null,
    isPersonal: false,
    ownerUserId: null,
    departmentId: null,
  });
  await MemoryProjectRepository.create({ memory: database }).create({
    id: "project_1",
    name: "Checkout assistant",
    slug: "checkout-assistant",
    apiKey: "sk-lw-1",
    teamId: TEAM_ID,
    language: "python",
    framework: "openai",
  });

  return {
    database,
    repository: MemoryProjectStorageSettingsRepository.create({ memory: database }),
  };
}

describe("MemoryProjectStorageSettingsRepository", () => {
  describe("when settings are written", () => {
    it("holds them as given and leaves a key that was not sent", async () => {
      const { database, repository } = await seeded();
      await repository.update({
        projectId: "project_1",
        organizationId: ORGANIZATION_ID,
        settings: { s3Endpoint: "https://s3.example", s3SecretAccessKey: "shh" },
      });

      const stored = await repository.update({
        projectId: "project_1",
        organizationId: ORGANIZATION_ID,
        settings: { s3Endpoint: null, s3Bucket: undefined },
      });

      expect(stored).toEqual({ s3Endpoint: null });
      expect(database.findProject("project_1")).toMatchObject({
        s3Endpoint: null,
        s3SecretAccessKey: "shh",
      });
    });
  });

  describe("when the project is not in the organization", () => {
    it("refuses the write", async () => {
      const { repository } = await seeded();

      await expect(
        repository.update({
          projectId: "project_1",
          organizationId: "another",
          settings: { s3Endpoint: "https://s3.example" },
        }),
      ).rejects.toBeInstanceOf(ProjectNotFoundError);
    });
  });
});
