import type { Organization, Project, Team } from "@prisma/client";
import { nanoid } from "nanoid";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  llmPromptConfigFactory,
  llmPromptConfigVersionFactory,
} from "~/factories/llm-config.factory";
import { projectFactory } from "~/factories/project.factory";
import { prisma } from "~/server/db";
import { LlmConfigVersionsRepository } from "~/server/prompt-config/repositories/llm-config-versions.repository";
import { LATEST_SCHEMA_VERSION } from "~/server/prompt-config/repositories/llm-config-version-schema";
import { app } from "../[[...route]]/app";

/**
 * A prompt version must never persist a sampling parameter the chosen model
 * rejects. Enforced at the single write boundary (createVersion) so the stored
 * data is honest — `langwatch prompt pull` then never writes, e.g., a
 * `temperature` into local YAML that breaks the next gpt-5-family call. We do
 * not invent or alter values: a legitimate value on a model that supports the
 * parameter is kept untouched.
 */
describe("prompt sync fidelity — sampling parameters", () => {
  let testOrganization: Organization;
  let testTeam: Team;
  let testProject: Project;
  let testApiKey: string;

  async function publishPromptOnModel(model: string, temperature: number) {
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

    // Seed an initial version so the config exists, then publish a new
    // version on the target model — the flow the customer hit.
    const seed = llmPromptConfigVersionFactory.build({
      configId: config.id,
      projectId: testProject.id,
    });
    await prisma.llmPromptConfigVersion.create({
      data: {
        id: seed.id,
        configId: config.id,
        projectId: testProject.id,
        version: 0,
        schemaVersion: seed.schemaVersion,
        configData: seed.configData as any,
        commitMessage: "seed",
      },
    });

    const repository = new LlmConfigVersionsRepository(prisma);
    const version = await repository.createVersion({
      organizationId: testOrganization.id,
      versionData: {
        configId: config.id,
        projectId: testProject.id,
        schemaVersion: LATEST_SCHEMA_VERSION,
        commitMessage: "v1",
        authorId: null,
        configData: {
          prompt: "You are a helpful assistant",
          model,
          temperature,
          messages: [],
          inputs: [{ identifier: "input", type: "str" }],
          outputs: [{ identifier: "output", type: "str" }],
        },
      } as any,
    });

    return { config, version };
  }

  async function getViaApi(id: string) {
    const res = await app.request(`/api/prompts/${id}`, {
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

  describe("when publishing a version on a model that does not support temperature", () => {
    /** @scenario Publishing a prompt version on a model that rejects temperature never stores it */
    it("does not persist the temperature, so the API never returns one", async () => {
      const { config, version } = await publishPromptOnModel(
        "openai/gpt-5.4-mini",
        0.4,
      );

      // Stored data is honest — the value never made it to the DB.
      expect(
        (version.configData as Record<string, unknown>).temperature,
      ).toBeUndefined();

      const body = await getViaApi(config.id);
      expect(body.model).toBe("openai/gpt-5.4-mini");
      expect(body.temperature).toBeUndefined();
    });
  });

  describe("when publishing a version on a model that supports temperature", () => {
    /** @scenario Publishing a prompt version on a model that supports temperature keeps it */
    it("persists the temperature untouched", async () => {
      const { config, version } = await publishPromptOnModel(
        "openai/gpt-4o-mini",
        0.4,
      );

      expect(
        (version.configData as Record<string, unknown>).temperature,
      ).toBe(0.4);

      const body = await getViaApi(config.id);
      expect(body.model).toBe("openai/gpt-4o-mini");
      expect(body.temperature).toBe(0.4);
    });
  });
});
