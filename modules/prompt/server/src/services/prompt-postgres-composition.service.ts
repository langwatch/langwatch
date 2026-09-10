import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import { PromptService } from "./prompt.service.ts";
import { PromptTagService } from "./prompt-tag.service.ts";
import { PromptVersionService } from "./prompt-version.service.ts";
import {
  PrismaPromptTagAssignmentRepository,
  type PromptTagAssignmentDatabase,
} from "../repositories/prisma/prisma.prompt-tag-assignment.repository.ts";
import {
  PrismaPromptTagRepository,
  type PromptTagDatabase,
} from "../repositories/prisma/prisma.prompt-tag.repository.ts";
import {
  PrismaLlmConfigRepository,
  type PromptConfigDatabase,
} from "../repositories/prisma/prisma.prompt.repository.ts";
import type { PromptVersionDatabase } from "../repositories/prisma/prisma.prompt-version.repository.ts";

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
  modelProvider?: ModelProviderApi;
}

/** Process-owned PostgreSQL composition for the Prompt feature. */
export class PostgresPromptAdapter {
  private constructor(private readonly options: PostgresPromptAdapterOptions) {}

  static create(options: PostgresPromptAdapterOptions): PostgresPromptAdapter {
    return new PostgresPromptAdapter(options);
  }

  build(): PromptService {
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
