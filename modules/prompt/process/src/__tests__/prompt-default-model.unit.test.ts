import { createApiFixture } from "@langwatch/api-fixture";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import { describe, expect, it } from "vitest";

import { MemoryPromptRepositories } from "../repositories/memory/memory.prompt.repositories.ts";
import { PromptTagService } from "../services/prompt-tag.service.ts";
import { PromptVersionService } from "../services/prompt-version.service.ts";
import { PromptService } from "../services/prompt.service.ts";
import { defaultModelFixture } from "./default-model.test-fixture.ts";

function promptsOver(modelProviders: ModelProviderApi): PromptService {
  const repositories = MemoryPromptRepositories.create();
  return PromptService.create({
    repository: repositories.configs,
    versionService: PromptVersionService.create(),
    tagRepository: repositories.tagAssignments,
    promptTagRepository: repositories.tags,
    tagService: PromptTagService.create(repositories.tags),
    modelProviders,
  });
}

const PROMPT = {
  projectId: "project-1",
  organizationId: "organization-1",
  handle: "support/tone-check",
  prompt: "You are a helpful assistant.",
};

describe("PromptService.createPrompt", () => {
  describe("given the project's default model for prompts", () => {
    /** @scenario "a prompt created without a model takes the project's default model" */
    it("writes the resolved default into a prompt that names no model", async () => {
      const created = await promptsOver(defaultModelFixture("openai/gpt-5.6-terra")).createPrompt(
        PROMPT,
      );

      expect(created.model).toBe("openai/gpt-5.6-terra");
    });

    /** @scenario "a prompt created with a model never asks for the project's default" */
    it("keeps the named model without resolving the default", async () => {
      const created = await promptsOver(createApiFixture<ModelProviderApi>()).createPrompt({
        ...PROMPT,
        model: "openai/gpt-5-mini",
      });

      expect(created.model).toBe("openai/gpt-5-mini");
    });
  });
});
