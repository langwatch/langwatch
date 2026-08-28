import type { PromptService as PromptServiceContract } from "@langwatch/prompt-contract";
import type { PrismaClient } from "../repositories/prisma/prisma.prompt.repository";
import type { ModelProviderService } from "@langwatch/model-provider-contract";
import { PromptService } from "../services/prompt.service";
import { PromptTagService } from "../services/prompt-tag.service";
import { PromptVersionService } from "../services/prompt-version.service";
import { PromptTagAssignmentRepository } from "../repositories/prisma/prisma.prompt-tag-assignment.repository";
import { PromptTagRepository } from "../repositories/prisma/prisma.prompt-tag.repository";
import { LlmConfigRepository } from "../repositories/prisma/prisma.prompt.repository";

export interface PostgresPromptAdapterOptions {
  database: PrismaClient;
  modelProvider?: ModelProviderService;
}

/** Process-owned PostgreSQL composition for the Prompt feature. */
export class PostgresPromptAdapter {
  private constructor(private readonly options: PostgresPromptAdapterOptions) {}

  static create(options: PostgresPromptAdapterOptions): PostgresPromptAdapter {
    return new PostgresPromptAdapter(options);
  }

  build(): PromptServiceContract {
    const repository = new LlmConfigRepository(
      this.options.database,
      undefined,
      this.options.modelProvider,
    );
    const promptTagRepository = new PromptTagRepository(this.options.database);

    return PromptService.create({
      repository,
      versionService: PromptVersionService.create(),
      tagRepository: new PromptTagAssignmentRepository(this.options.database),
      promptTagRepository,
      tagService: PromptTagService.create(promptTagRepository),
    });
  }
}
