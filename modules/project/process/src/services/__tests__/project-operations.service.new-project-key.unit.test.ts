import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { Project } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { ProjectCredentialsService } from "../project-credentials.service.ts";
import {
  ProjectOperationsService,
  type ProjectOperationsDirectory,
} from "../project-operations.service.ts";

/** Only `getById` answers: the status read touches nothing else. */
class NewProjectDirectory implements ProjectOperationsDirectory {
  constructor(private readonly project: Project) {}

  getById: ProjectOperationsDirectory["getById"] = async () => this.project;
  findWithTeam: ProjectOperationsDirectory["findWithTeam"] = () => this.refuse();
  update: ProjectOperationsDirectory["update"] = () => this.refuse();
  create: ProjectOperationsDirectory["create"] = () => this.refuse();
  archive: ProjectOperationsDirectory["archive"] = () => this.refuse();
  rotateLegacyApiKey: ProjectOperationsDirectory["rotateLegacyApiKey"] = () => this.refuse();

  private refuse(): Promise<never> {
    return Promise.reject(new Error("only the status read is under test"));
  }
}

function newProject({ apiKey }: { apiKey: string }): Project {
  const timestamp = new Date("2026-10-06T00:00:00.000Z");

  return {
    id: "project_gamma",
    name: "gamma",
    slug: "gamma",
    apiKey,
    lwqlKey: "lwql-test",
    teamId: "team-1",
    language: "typescript",
    framework: "test",
    kind: "application",
    firstMessage: false,
    integrated: false,
    createdAt: timestamp,
    updatedAt: timestamp,
    userLinkTemplate: null,
    traceSharingEnabled: false,
    presenceEnabled: true,
    s3Endpoint: null,
    s3AccessKeyId: null,
    s3SecretAccessKey: null,
    s3Bucket: null,
    archivedAt: null,
    isPersonal: false,
    ownerUserId: null,
    personalFeatures: {},
    departmentId: null,
    langyEgressAllowlist: null,
    lastCodingAgentSessionAt: null,
    lastCodingAgentPullRequestAt: null,
  };
}

function operationsOver({ project }: { project: Project }): ProjectOperationsService {
  return ProjectOperationsService.create({
    projects: new NewProjectDirectory(project),
    storageSettings: { update: async ({ settings }) => settings },
    auditLog: createApiFixture<AuditLogApi>({}, "AuditLogApi"),
    lifecycle: {
      legacyKeyRevoked: async () => undefined,
      presenceSettingChanged: async () => undefined,
      traceSharingDisabled: async () => undefined,
    },
    logger: { error: () => undefined },
  });
}

describe("ProjectOperationsService", () => {
  describe("when a project was just created", () => {
    /** @scenario "A new project gets no customer-facing project key" */
    it("answers that it has no legacy key, so no project key row is listed", async () => {
      const apiKey = ProjectCredentialsService.create().generateApiKey();
      const operations = operationsOver({ project: newProject({ apiKey }) });

      await expect(operations.getLegacyKeyStatus({ projectId: "project_gamma" })).resolves.toEqual({
        present: false,
      });
    });
  });
});
