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
    it("each entry includes the latest tag plus tags pointing at the latest version", async () => {
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
        { name: "latest", versionId: v2.id },
        { name: "production", versionId: v2.id },
      ]);
    });
  });

  describe("GET /api/prompts/:id", () => {
    it("returns the latest tag plus custom tags on the default (latest) version", async () => {
      const res = await get(`/api/prompts/${promptConfig.id}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        versionId: string;
        tags: Array<{ name: string; versionId: string }>;
      };
      expect(body.versionId).toBe(v2.id);
      expect(body.tags).toEqual([
        { name: "latest", versionId: v2.id },
        { name: "production", versionId: v2.id },
      ]);
    });

    it("when fetched with ?tag=staging returns only tags pointing at that (non-latest) version", async () => {
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

    it("when fetched with ?tag=latest resolves to the latest version (round-trip works)", async () => {
      const res = await get(
        `/api/prompts/${promptConfig.id}?tag=latest`,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        versionId: string;
        tags: Array<{ name: string; versionId: string }>;
      };
      expect(body.versionId).toBe(v2.id);
      expect(body.tags).toEqual([
        { name: "latest", versionId: v2.id },
        { name: "production", versionId: v2.id },
      ]);
    });
  });

  describe("GET /api/prompts/:id/versions", () => {
    it("marks only the latest row with the latest tag alongside any custom tags", async () => {
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
      expect(v2Row?.tags).toEqual([
        { name: "latest", versionId: v2.id },
        { name: "production", versionId: v2.id },
      ]);
    });
  });
});

/**
 * Org-scoped prompt visibility: a prompt with scope=ORGANIZATION created in
 * project A must surface its tag assignments when read from a sibling project
 * B in the same organization. The write-side (tag assign) at
 * langwatch/src/app/api/prompts/[[...route]]/app.v1.ts:111-189 scopes
 * PromptTagAssignment by the config's projectId; the read path must mirror
 * this so the same tags become visible across the organization. Without
 * this coverage the read path could silently filter assignments by the
 * caller's projectId and hide tags for org-scoped prompts.
 */
describe("Prompt tags for org-scoped prompts across sibling projects", () => {
  let testOrganization: Organization;
  let testTeam: Team;
  let projectA: Project;
  let projectB: Project;
  let projectBApiKey: string;
  let orgConfig: LlmPromptConfig;
  let orgVersion: LlmPromptConfigVersion;
  let canaryTag: PromptTag;

  async function getFromProjectB(path: string) {
    return app.request(path, {
      headers: { "X-Auth-Token": projectBApiKey },
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

    projectA = await prisma.project.create({
      data: {
        ...projectFactory.build({ slug: `test-project-a-${slug}` }),
        teamId: testTeam.id,
      },
    });
    projectB = await prisma.project.create({
      data: {
        ...projectFactory.build({ slug: `test-project-b-${slug}` }),
        teamId: testTeam.id,
      },
    });
    projectBApiKey = projectB.apiKey;

    const configData = llmPromptConfigFactory.build({
      projectId: projectA.id,
      organizationId: testOrganization.id,
      handle: `org-prompt-${nanoid()}`,
    });
    orgConfig = await prisma.llmPromptConfig.create({
      data: {
        id: configData.id,
        name: configData.name,
        projectId: projectA.id,
        organizationId: testOrganization.id,
        handle: `${testOrganization.id}/${configData.handle}`,
        scope: "ORGANIZATION",
      },
    });

    const versionData = llmPromptConfigVersionFactory.build({
      configId: orgConfig.id,
      projectId: projectA.id,
    });
    orgVersion = await prisma.llmPromptConfigVersion.create({
      data: {
        id: versionData.id,
        configId: orgConfig.id,
        projectId: projectA.id,
        version: 1,
        schemaVersion: versionData.schemaVersion,
        configData: versionData.configData as any,
        commitMessage: "initial",
      },
    });

    canaryTag = await prisma.promptTag.create({
      data: {
        id: `ptag_${nanoid()}`,
        organizationId: testOrganization.id,
        name: "canary",
      },
    });

    // Assignment is scoped by the config's projectId (project A) — see the
    // write-path comment about org-scoped prompts.
    await prisma.promptTagAssignment.create({
      data: {
        id: `vtag_${nanoid()}`,
        configId: orgConfig.id,
        versionId: orgVersion.id,
        tagId: canaryTag.id,
        projectId: projectA.id,
      },
    });
  });

  afterEach(async () => {
    await prisma.promptTagAssignment.deleteMany({
      where: { projectId: { in: [projectA.id, projectB.id] } },
    });
    await prisma.promptTag.deleteMany({
      where: { organizationId: testOrganization.id },
    });
    await prisma.llmPromptConfig.deleteMany({
      where: { organizationId: testOrganization.id },
    });
    await prisma.project.delete({ where: { id: projectA.id } });
    await prisma.project.delete({ where: { id: projectB.id } });
    await prisma.team.delete({ where: { id: testTeam.id } });
    await prisma.organization.delete({ where: { id: testOrganization.id } });
  });

  describe("when reading from a sibling project", () => {
    it("GET /api/prompts surfaces tags for the org-scoped prompt", async () => {
      const res = await getFromProjectB("/api/prompts");
      expect(res.status).toBe(200);
      const body = (await res.json()) as Array<{
        id: string;
        tags: Array<{ name: string; versionId: string }>;
      }>;

      const row = body.find((p) => p.id === orgConfig.id);
      expect(row).toBeDefined();
      expect(row?.tags).toEqual([
        { name: "latest", versionId: orgVersion.id },
        { name: "canary", versionId: orgVersion.id },
      ]);
    });

    it("GET /api/prompts/:id surfaces tags for the org-scoped prompt", async () => {
      const res = await getFromProjectB(`/api/prompts/${orgConfig.id}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        tags: Array<{ name: string; versionId: string }>;
      };
      expect(body.tags).toEqual([
        { name: "latest", versionId: orgVersion.id },
        { name: "canary", versionId: orgVersion.id },
      ]);
    });
  });
});
