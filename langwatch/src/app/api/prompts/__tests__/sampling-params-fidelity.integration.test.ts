import type { Organization, Project, Team } from "@prisma/client";
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
 * The prompts REST API must never hand back a sampling parameter the model
 * provider would reject — otherwise `langwatch prompt pull` writes, e.g., a
 * `temperature` into local YAML that breaks the next call against the gpt-5
 * family (whose registry entry does not list `temperature`).
 */
describe("prompt sync fidelity — sampling parameters", () => {
  let testOrganization: Organization;
  let testTeam: Team;
  let testProject: Project;
  let testApiKey: string;

  async function createPromptOnModel(model: string, temperature: number) {
    const configData = llmPromptConfigFactory.build({
      projectId: testProject.id,
      organizationId: testOrganization.id,
      handle: `h-${nanoid()}`,
    });

    const config = await prisma.llmPromptConfig.create({
      data: {
        id: configData.id,
        name: configData.name,
        projectId: testProject.id,
        organizationId: testOrganization.id,
        handle: configData.handle,
        scope: configData.scope,
      },
    });

    const versionData = llmPromptConfigVersionFactory.build({
      configId: config.id,
      projectId: testProject.id,
      configData: {
        prompt: "You are a helpful assistant",
        model,
        temperature,
        inputs: [{ identifier: "input", type: "str" }],
        outputs: [{ identifier: "output", type: "str" }],
      } as any,
    });

    await prisma.llmPromptConfigVersion.create({
      data: {
        id: versionData.id,
        configId: config.id,
        projectId: testProject.id,
        version: 1,
        schemaVersion: versionData.schemaVersion,
        configData: versionData.configData as any,
        commitMessage: "v1",
        createdAt: new Date("2026-01-01T00:00:00Z"),
      },
    });

    return config;
  }

  async function get(path: string) {
    const res = await app.request(path, {
      headers: { "X-Auth-Token": testApiKey },
    });
    return res.json();
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
  });

  afterEach(async () => {
    await prisma.llmPromptConfig.deleteMany({
      where: { projectId: testProject.id },
    });
    await prisma.project.delete({ where: { id: testProject.id } });
    await prisma.team.delete({ where: { id: testTeam.id } });
    await prisma.organization.delete({ where: { id: testOrganization.id } });
  });

  describe("when the stored model does not support temperature", () => {
    /** @scenario Pulling a gpt-5-family prompt never writes a temperature it cannot accept */
    it("omits temperature from the API response", async () => {
      const config = await createPromptOnModel("openai/gpt-5.4-mini", 0.4);

      const body = await get(`/api/prompts/${config.id}`);

      expect(body.model).toBe("openai/gpt-5.4-mini");
      expect(body.temperature).toBeUndefined();
    });
  });

  describe("when the stored model supports temperature", () => {
    /** @scenario Pulling a prompt on a model that supports temperature keeps the temperature */
    it("keeps temperature in the API response", async () => {
      const config = await createPromptOnModel("openai/gpt-4o-mini", 0.4);

      const body = await get(`/api/prompts/${config.id}`);

      expect(body.model).toBe("openai/gpt-4o-mini");
      expect(body.temperature).toBe(0.4);
    });
  });
});
