/**
 * The Prompt feature's test seam: the real prompt service over the Prisma
 * client a caller already opened, so another module's integration test reads
 * back the prompt versions it wrote rather than a double's idea of them.
 */
import type { ModelProviderApi } from "@langwatch/model-provider-contract";

import { PostgresPromptRepositories } from "../repositories/prisma/prisma.prompt.repositories.ts";
import { PromptTagService } from "../services/prompt-tag.service.ts";
import { PromptVersionService } from "../services/prompt-version.service.ts";
import { PromptService } from "../services/prompt.service.ts";

export function promptServiceFixture({
  database,
  modelProviders,
}: {
  database: Parameters<typeof PostgresPromptRepositories.create>[0]["prisma"];
  modelProviders: ModelProviderApi;
}): PromptService {
  const repositories = PostgresPromptRepositories.create({ prisma: database });

  return PromptService.create({
    repository: repositories.configs,
    versionService: PromptVersionService.create(),
    tagRepository: repositories.tagAssignments,
    promptTagRepository: repositories.tags,
    tagService: PromptTagService.create(repositories.tags),
    modelProviders,
  });
}
