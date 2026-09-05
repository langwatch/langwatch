import type { PromptService as PromptServiceContract } from "@langwatch/prompt-contract";
import type { ModelProviderService } from "@langwatch/model-provider-contract";
import { PromptService } from "../services/prompt.service";
import { PromptTagService } from "../services/prompt-tag.service";
import { PromptVersionService } from "../services/prompt-version.service";
import {
  PrismaPromptTagAssignmentRepository,
  type PromptTagAssignmentDatabase,
} from "../repositories/prisma/prisma.prompt-tag-assignment.repository";
import {
  PrismaPromptTagRepository,
  type PromptTagDatabase,
} from "../repositories/prisma/prisma.prompt-tag.repository";
import {
  PrismaLlmConfigRepository,
  type PromptConfigDatabase,
} from "../repositories/prisma/prisma.prompt.repository";
import type { PromptVersionDatabase } from "../repositories/prisma/prisma.prompt-version.repository";

/**
 * Everything Prompt persistence touches, as the four private repositories below declare
 * it.
 */
export type PromptPersistence = PromptConfigDatabase &
  PromptVersionDatabase &
  PromptTagDatabase &
  PromptTagAssignmentDatabase;

export interface PostgresPromptAdapterOptions {
  database: PromptPersistence;
  /**
   * The provider cascade a prompt created without a model falls back to.
   */
  modelProvider?: ModelProviderService;
}

/** Process-owned PostgreSQL composition for the Prompt feature. */
export class PostgresPromptAdapter {
  private constructor(private readonly options: PostgresPromptAdapterOptions) {}

  static create(options: PostgresPromptAdapterOptions): PostgresPromptAdapter {
    return new PostgresPromptAdapter(options);
  }

  build(): PromptServiceContract {
    const repository = PrismaLlmConfigRepository.create({
      prisma: this.options.database,
      modelProvider: this.options.modelProvider,
    });
    const promptTagRepository = PrismaPromptTagRepository.create({
      prisma: this.options.database,
    });

    return PromptService.create({
      repository,
      versionService: PromptVersionService.create(),
      tagRepository: PrismaPromptTagAssignmentRepository.create({
        prisma: this.options.database,
      }),
      promptTagRepository,
      tagService: PromptTagService.create(promptTagRepository),
    });
  }
}
