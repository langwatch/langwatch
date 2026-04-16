import type {
  LlmPromptConfig,
  LlmPromptConfigVersion,
  Organization,
  Project,
  PromptTag,
  Team,
} from "@prisma/client";
import { nanoid } from "nanoid";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  llmPromptConfigFactory,
  llmPromptConfigVersionFactory,
} from "~/factories/llm-config.factory";
import { projectFactory } from "~/factories/project.factory";
import { prisma } from "~/server/db";
import { app } from "../[[...route]]/app";

/**
 * Verifies that the REST prompt responses include the `tags` array so that
 * CLI/SDK consumers can display which tags each prompt/version has.
 */
describe("Prompt tags appear in prompt responses", () => {
  let testOrganization: Organization;
  let testTeam: Team;
  let testProject: Project;
  let testApiKey: string;
  let promptConfig: LlmPromptConfig;
  let v1: LlmPromptConfigVersion;
  let v2: LlmPromptConfigVersion;
  let productionTag: PromptTag;
  let stagingTag: PromptTag;

  async function get(path: string) {
    return app.request(path, {
      headers: { "X-Auth-Token": testApiKey },
    });
  }

  beforeEach(async () => {
    const slug = nanoid();

    testOrganization = await prisma.organization.create({
      data: { name: "Test Org", slug: `test-org-${slug}` },
    });

    testTeam = await prisma.team.create({
      data: {
        name: "Test Team",
        slug: `test-team-${slug}`,
        organizationId: testOrganization.id,
      },
    });

    testProject = await prisma.project.create({
      data: {
        ...projectFactory.build({ slug: `test-project-${slug}` }),
        teamId: testTeam.id,
      },
    });

    testApiKey = testProject.apiKey;

    const configData = llmPromptConfigFactory.build({
      projectId: testProject.id,
      organizationId: testOrganization.id,
      handle: `test-handle-${nanoid()}`,
    });

    promptConfig = await prisma.llmPromptConfig.create({
      data: {
        id: configData.id,
        name: configData.name,
        projectId: testProject.id,
        organizationId: testOrganization.id,
        handle: configData.handle,
        scope: configData.scope,
      },
    });

    const v1Data = llmPromptConfigVersionFactory.build({
      configId: promptConfig.id,
      projectId: testProject.id,
    });
    v1 = await prisma.llmPromptConfigVersion.create({
      data: {
        id: v1Data.id,
        configId: promptConfig.id,
        projectId: testProject.id,
        version: 1,
        schemaVersion: v1Data.schemaVersion,
        configData: v1Data.configData as any,
        commitMessage: "v1",
        createdAt: new Date("2026-01-01T00:00:00Z"),
      },
    });

    const v2Data = llmPromptConfigVersionFactory.build({
      configId: promptConfig.id,
      projectId: testProject.id,
    });
    v2 = await prisma.llmPromptConfigVersion.create({
      data: {
        id: v2Data.id,
        configId: promptConfig.id,
        projectId: testProject.id,
        version: 2,
        schemaVersion: v2Data.schemaVersion,
        configData: v2Data.configData as any,
        commitMessage: "v2",
        createdAt: new Date("2026-01-02T00:00:00Z"),
      },
    });

    productionTag = await prisma.promptTag.create({
      data: {
        id: `ptag_${nanoid()}`,
        organizationId: testOrganization.id,
        name: "production",
      },
    });

    stagingTag = await prisma.promptTag.create({
      data: {
        id: `ptag_${nanoid()}`,
        organizationId: testOrganization.id,
        name: "staging",
      },
    });

    // production -> v2 (latest), staging -> v1 (older)
    await prisma.promptTagAssignment.create({
      data: {
        id: `vtag_${nanoid()}`,
        configId: promptConfig.id,
        versionId: v2.id,
        tagId: productionTag.id,
        projectId: testProject.id,
      },
    });

    await prisma.promptTagAssignment.create({
      data: {
        id: `vtag_${nanoid()}`,
        configId: promptConfig.id,
        versionId: v1.id,
        tagId: stagingTag.id,
        projectId: testProject.id,
      },
    });
  });

  afterEach(async () => {
    await prisma.promptTagAssignment.deleteMany({
      where: { projectId: testProject.id },
    });
    await prisma.promptTag.deleteMany({
      where: { organizationId: testOrganization.id },
    });
    await prisma.llmPromptConfig.deleteMany({
      where: { projectId: testProject.id },
    });
    await prisma.project.delete({ where: { id: testProject.id } });
    await prisma.team.delete({ where: { id: testTeam.id } });
    await prisma.organization.delete({ where: { id: testOrganization.id } });
  });

  describe("GET /api/prompts", () => {
    it("each entry includes only tags pointing at its latest version", async () => {
      const res = await get("/api/prompts");
      expect(res.status).toBe(200);
      const body = (await res.json()) as Array<{
        id: string;
        versionId: string;
        tags: Array<{ name: string; versionId: string }>;
      }>;

      const row = body.find((p) => p.id === promptConfig.id);
      expect(row).toBeDefined();
      expect(row?.versionId).toBe(v2.id);
      expect(row?.tags).toEqual([
        { name: "production", versionId: v2.id },
      ]);
    });
  });

  describe("GET /api/prompts/:id", () => {
    it("returns tags pointing at the default (latest) version", async () => {
      const res = await get(`/api/prompts/${promptConfig.id}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        versionId: string;
        tags: Array<{ name: string; versionId: string }>;
      };
      expect(body.versionId).toBe(v2.id);
      expect(body.tags).toEqual([{ name: "production", versionId: v2.id }]);
    });

    it("when fetched with ?tag=staging returns tags pointing at that version", async () => {
      const res = await get(
        `/api/prompts/${promptConfig.id}?tag=staging`,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        versionId: string;
        tags: Array<{ name: string; versionId: string }>;
      };
      expect(body.versionId).toBe(v1.id);
      expect(body.tags).toEqual([{ name: "staging", versionId: v1.id }]);
    });
  });

  describe("GET /api/prompts/:id/versions", () => {
    it("each version row includes the tags pointing at it", async () => {
      const res = await get(`/api/prompts/${promptConfig.id}/versions`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as Array<{
        version: number;
        versionId: string;
        tags: Array<{ name: string; versionId: string }>;
      }>;

      const v1Row = body.find((r) => r.version === 1);
      const v2Row = body.find((r) => r.version === 2);
      expect(v1Row?.tags).toEqual([{ name: "staging", versionId: v1.id }]);
      expect(v2Row?.tags).toEqual([{ name: "production", versionId: v2.id }]);
    });
  });
});
