import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
  type PrismaConnection,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { aesEncryption } from "@langwatch/process-stores";
import type { ShareApi } from "@langwatch/share-contract";
import { createTestLogger } from "@langwatch/test-harness";
/**
 * @vitest-environment node
 * Stored-object credentials are sealed by the live tier, over real rows.
 * @see specs/projects/projects-browser-door.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { TopicApi } from "@langwatch/topic-contract";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ProjectCreatedNoticeService } from "../../../services/project-created-notice.service.ts";
import type { ProjectCredentials } from "../../../services/project-credentials.service.ts";
import { ProjectOperationsService } from "../../../services/project-operations.service.ts";
import { ProjectService } from "../../../services/project.service.ts";
import { PostgresProjectRepositories } from "../prisma.project.repositories.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;
const namespace = `project-storage-${nanoid(8)}`;
const cipher = aesEncryption(new Uint8Array(32).fill(7));
const credentials: ProjectCredentials = {
  generateProjectId: () => `${namespace}-${nanoid(10)}`,
  generateApiKey: () => `sk-lw-test-${nanoid(16)}`,
};

describe.skipIf(!DB_URL)("the live project repositories over Postgres", () => {
  const connection: PrismaConnection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createTestLogger().logger,
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client as PrismaClient;
  const repositories = PostgresProjectRepositories.create({ prisma, encryption: cipher });
  const ids = { organization: "", team: "", project: "" };

  const operations = ProjectOperationsService.create({
    projects: ProjectService.create({
      created: ProjectCreatedNoticeService.create({
        logger: { error: () => undefined },
        projects: {
          findWithOrgAdmin: async () => null,
          findIdsByOrganization: async () => [],
          findWithTeam: async () => null,
        },
      }),
      repository: repositories.projects,
      credentials,
      organizations: createApiFixture<OrganizationApi>({}, "organizations"),
    }),
    storageSettings: repositories.storageSettings,
    auditLog: createApiFixture<AuditLogApi>({}, "auditLog"),
    lifecycle: {
      legacyKeyRevoked: async () => undefined,
      presenceSettingChanged: async () => undefined,
    },
    logger: { error: () => undefined },
    share: createApiFixture<ShareApi>({}, "share"),
    topics: createApiFixture<TopicApi>({}, "topics"),
    now: () => 0,
  });

  const storedRow = () =>
    prisma.project.findUniqueOrThrow({
      where: { id: ids.project },
      select: { s3Endpoint: true, s3AccessKeyId: true, s3SecretAccessKey: true, s3Bucket: true },
    });

  beforeAll(async () => {
    const organization = await prisma.organization.create({
      data: { name: `Org ${namespace}`, slug: `--test-org-${namespace}` },
    });
    ids.organization = organization.id;
    const team = await prisma.team.create({
      data: {
        name: `Team ${namespace}`,
        slug: `team-${namespace}`,
        organizationId: organization.id,
      },
    });
    ids.team = team.id;
    const project = await prisma.project.create({
      data: {
        id: `${namespace}-project`,
        name: `Project ${namespace}`,
        slug: `project-${namespace}`,
        apiKey: `sk-lw-test-${namespace}`,
        teamId: team.id,
        language: "python",
        framework: "openai",
      },
    });
    ids.project = project.id;
  });

  afterAll(async () => {
    await prisma.project.deleteMany({ where: { id: ids.project } });
    await prisma.team.deleteMany({ where: { id: ids.team } });
    await prisma.organization.deleteMany({ where: { id: ids.organization } });
  });

  describe("when the settings form saves stored-object credentials", () => {
    /** @scenario stored-object credentials are written through the deployment's cipher */
    it("stores each credential enciphered, which the deployment's cipher opens", async () => {
      const answer = await operations.updateSettings(
        {
          projectId: ids.project,
          s3Endpoint: "https://s3.example",
          s3AccessKeyId: "AKIAEXAMPLE",
          s3SecretAccessKey: "the-secret",
          s3Bucket: "bucket",
        },
        { id: "user-1" },
      );

      const row = await storedRow();
      expect(row.s3Endpoint).not.toBe("https://s3.example");
      expect(row.s3AccessKeyId).not.toBe("AKIAEXAMPLE");
      expect(row.s3SecretAccessKey).not.toBe("the-secret");
      expect(cipher.decrypt(row.s3Endpoint ?? "")).toBe("https://s3.example");
      expect(cipher.decrypt(row.s3AccessKeyId ?? "")).toBe("AKIAEXAMPLE");
      expect(cipher.decrypt(row.s3SecretAccessKey ?? "")).toBe("the-secret");
      expect(row.s3Bucket).toBe("bucket");
      expect(answer).toMatchObject({
        s3Endpoint: row.s3Endpoint,
        s3SecretAccessKey: row.s3SecretAccessKey,
      });
    });

    /** @scenario A blank storage secret leaves the stored secret unchanged */
    it("leaves the stored secret as it was when none is sent", async () => {
      const before = await storedRow();

      await operations.updateSettings(
        {
          projectId: ids.project,
          s3Endpoint: "https://s3.other",
          s3AccessKeyId: "AKIAOTHER",
        },
        { id: "user-1" },
      );

      const row = await storedRow();
      expect(row.s3SecretAccessKey).toBe(before.s3SecretAccessKey);
      expect(cipher.decrypt(row.s3Endpoint ?? "")).toBe("https://s3.other");
    });

    /** @scenario Clearing the storage settings clears the stored secret */
    it("clears every credential when the block is cleared", async () => {
      await operations.updateSettings(
        { projectId: ids.project, s3SecretAccessKey: null },
        { id: "user-1" },
      );

      expect(await storedRow()).toMatchObject({
        s3Endpoint: null,
        s3AccessKeyId: null,
        s3SecretAccessKey: null,
      });
    });
  });

  describe("when the project is not live in the organization", () => {
    it("refuses the write and stores nothing", async () => {
      await expect(
        repositories.storageSettings.update({
          projectId: ids.project,
          organizationId: "another-organization",
          settings: { s3Endpoint: "https://s3.example" },
        }),
      ).rejects.toMatchObject({ code: "project_not_found" });

      expect((await storedRow()).s3Endpoint).toBeNull();
    });
  });
});
