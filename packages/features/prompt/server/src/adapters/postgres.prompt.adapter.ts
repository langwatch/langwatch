import type { PromptService as PromptServiceContract } from "@langwatch/prompt-contract";
import type { ModelProviderService } from "@langwatch/model-provider-contract";
import { PromptService } from "../services/prompt.service";
import { PromptTagService } from "../services/prompt-tag.service";
import { PromptVersionService } from "../services/prompt-version.service";
import {
  PromptTagAssignmentRepository,
  type PromptTagAssignmentDatabase,
} from "../repositories/prisma/prisma.prompt-tag-assignment.repository";
import {
  PromptTagRepository,
  type PromptTagDatabase,
} from "../repositories/prisma/prisma.prompt-tag.repository";
import {
  LlmConfigRepository,
  type PromptConfigDatabase,
} from "../repositories/prisma/prisma.prompt.repository";
import type { PromptVersionDatabase } from "../repositories/prisma/prisma.prompt-version.repository";

/**
 * Everything Prompt persistence touches, as the four private repositories
 * below declare it.
 *
 * A composed slice rather than the generated client: a process hands the one
 * it already holds and it fits, while this file — and every layer above it —
 * names no generated declaration at all.
 */
export type PromptPersistence = PromptConfigDatabase &
  PromptVersionDatabase &
  PromptTagDatabase &
  PromptTagAssignmentDatabase;

export interface PostgresPromptAdapterOptions {
  database: PromptPersistence;
  /**
   * The provider cascade a prompt created without a model falls back to.
   *
   * Optional because one caller composes no provider at all: the Langy prompt
   * seed script, which runs outside any App root and relies on the
   * repository's own last-resort default. Every process root injects one.
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
