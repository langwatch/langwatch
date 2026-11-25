/**
 * @vitest-environment node
 * @see specs/prompts/prompt-runtime-parameters.feature
 */
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
  type PrismaConnection,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { nanoid } from "nanoid";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { defaultModelFixture } from "../../__tests__/default-model.test-fixture.ts";
import { PrismaPromptTagAssignmentRepository } from "../../repositories/prisma/prisma.prompt-tag-assignment.repository.ts";
import { PrismaPromptTagRepository } from "../../repositories/prisma/prisma.prompt-tag.repository.ts";
import { PrismaLlmConfigRepository } from "../../repositories/prisma/prisma.prompt.repository.ts";
import { PromptTagService } from "../../services/prompt-tag.service.ts";
import { PromptVersionService } from "../../services/prompt-version.service.ts";
import { PromptService } from "../../services/prompt.service.ts";
import { buildPromptApp, mountPromptRest } from "./prompt-rest.harness.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL ?? process.env.DATABASE_URL;

const STRUCTURED_OUTPUT = {
  identifier: "answer",
  type: "json_schema",
  json_schema: { type: "object", properties: { answer: { type: "string" } } },
};

describe.skipIf(!DB_URL)("PUT /api/prompts/:id over the real prompt store", () => {
  const connection: PrismaConnection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger("langwatch:prompt:test"),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client as PrismaClient;

  const tagRepository = PrismaPromptTagRepository.create({ prisma });
  const tags = PromptTagService.create(tagRepository);
  const service = PromptService.create({
    modelProviders: defaultModelFixture(),
    repository: PrismaLlmConfigRepository.create({ prisma }),
    versionService: PromptVersionService.create(),
    tagRepository: PrismaPromptTagAssignmentRepository.create({ prisma }),
    promptTagRepository: tagRepository,
    tagService: tags,
  });

  let organizationId: string;
  let teamId: string;
  let projectId: string;

  beforeEach(async () => {
    const namespace = `carry-${nanoid(8)}`;
    const organization = await prisma.organization.create({
      data: { name: namespace, slug: `${namespace}-org` },
    });
    organizationId = organization.id;
    const team = await prisma.team.create({
      data: { name: namespace, slug: `${namespace}-team`, organizationId },
    });
    teamId = team.id;
    const project = await prisma.project.create({
      data: {
        id: `${namespace}-project`,
        name: namespace,
        slug: `${namespace}-project`,
        apiKey: `sk-lw-test-${nanoid(16)}`,
        teamId,
        language: "python",
        framework: "openai",
        personalFeatures: {},
      },
    });
    projectId = project.id;
    await tags.seedForOrganization({ organizationId });
  });

  afterEach(async () => {
    await prisma.promptTagAssignment.deleteMany({ where: { projectId } });
    await prisma.llmPromptConfigVersion.deleteMany({ where: { projectId } });
    await prisma.llmPromptConfig.deleteMany({ where: { projectId } });
    await prisma.promptTag.deleteMany({ where: { organizationId } });
    await prisma.project.deleteMany({ where: { id: projectId } });
    await prisma.team.delete({ where: { id: teamId } });
    await prisma.organization.delete({ where: { id: organizationId } });
  });

  function rest() {
    return mountPromptRest({ app: buildPromptApp(service), projectId, organizationId });
  }

  async function createConfiguredPrompt(): Promise<string> {
    const prompt = await service.createPrompt({
      projectId,
      organizationId,
      handle: `support-${nanoid(8)}`,
      prompt: "You answer in a {{tone}} tone.",
      messages: [{ role: "user", content: "{{question}}" }],
      model: "openai/gpt-5-mini",
      temperature: 0.3,
      maxTokens: 333,
      inputs: [
        { identifier: "tone", type: "str" },
        { identifier: "question", type: "str" },
      ],
      outputs: [STRUCTURED_OUTPUT],
      parameters: { search_iterations: 3 },
    } as Parameters<PromptService["createPrompt"]>[0]);
    return prompt.id;
  }

  async function update(id: string, body: Record<string, unknown>) {
    const response = await rest().request(`/api/prompts/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }

  async function latest(id: string): Promise<Record<string, unknown>> {
    const response = await rest().request(`/api/prompts/${id}`);
    expect(response.status).toBe(200);
    return (await response.json()) as Record<string, unknown>;
  }

  describe("when the body names only messages and a commit message", () => {
    /** @scenario Updating a prompt over the REST API with only messages keeps every other stored field */
    it("keeps parameters, inputs, outputs, model, temperature and max tokens", async () => {
      const id = await createConfiguredPrompt();

      const updated = await update(id, {
        commitMessage: "Reword the system prompt",
        messages: [
          { role: "system", content: "You always answer in a {{tone}} tone." },
          { role: "user", content: "{{question}}" },
        ],
      });

      expect(updated.status).toBe(200);
      const prompt = await latest(id);
      expect(prompt).toMatchObject({
        version: 2,
        prompt: "You always answer in a {{tone}} tone.",
        parameters: { search_iterations: 3 },
        inputs: [
          { identifier: "tone", type: "str" },
          { identifier: "question", type: "str" },
        ],
        outputs: [STRUCTURED_OUTPUT],
        model: "openai/gpt-5-mini",
        temperature: 0.3,
        maxTokens: 333,
      });
    });
  });

  describe("when the body names messages without a system message", () => {
    /** @scenario Updating messages without a system message keeps the stored system prompt */
    it("keeps the system prompt and replaces the other messages", async () => {
      const id = await createConfiguredPrompt();

      const updated = await update(id, {
        commitMessage: "Rephrase the question",
        messages: [{ role: "user", content: "Please answer: {{question}}" }],
      });

      expect(updated.status).toBe(200);
      const prompt = await latest(id);
      expect(prompt.prompt).toBe("You answer in a {{tone}} tone.");
      expect(prompt.messages).toEqual([
        { role: "system", content: "You answer in a {{tone}} tone." },
        { role: "user", content: "Please answer: {{question}}" },
      ]);
      expect(prompt.parameters).toEqual({ search_iterations: 3 });
    });
  });

  describe("when the body names new inputs, outputs and parameters", () => {
    /** @scenario Updating a prompt over the REST API replaces the inputs, outputs and parameters it names */
    it("stores the named fields and keeps the rest", async () => {
      const id = await createConfiguredPrompt();

      const updated = await update(id, {
        commitMessage: "Add a language variable",
        inputs: [
          { identifier: "tone", type: "str" },
          { identifier: "question", type: "str" },
          { identifier: "language", type: "str" },
        ],
        outputs: [{ identifier: "output", type: "str" }],
        parameters: { search_iterations: 5 },
      });

      expect(updated.status).toBe(200);
      const prompt = await latest(id);
      expect(prompt).toMatchObject({
        version: 2,
        prompt: "You answer in a {{tone}} tone.",
        inputs: [
          { identifier: "tone", type: "str" },
          { identifier: "question", type: "str" },
          { identifier: "language", type: "str" },
        ],
        outputs: [{ identifier: "output", type: "str" }],
        parameters: { search_iterations: 5 },
        temperature: 0.3,
        maxTokens: 333,
      });
    });
  });
});
