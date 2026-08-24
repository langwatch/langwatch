import type { PromptService as PromptServiceContract } from "@langwatch/prompt-contract";
import type { PrismaClient } from "../repositories/prisma/prisma.prompt.repository";
import type { ModelProviderService } from "@langwatch/model-provider-contract";
import { PromptService } from "../services/prompt.service";

export interface PostgresPromptAdapterOptions {
  database: PrismaClient;
  modelProvider: ModelProviderService;
}

/** Process-owned PostgreSQL composition for the Prompt feature. */
export class PostgresPromptAdapter {
  private constructor(private readonly options: PostgresPromptAdapterOptions) {}

  static create(options: PostgresPromptAdapterOptions): PostgresPromptAdapter {
    return new PostgresPromptAdapter(options);
  }

  build(): PromptServiceContract {
    return PromptService.create({
      database: this.options.database,
      modelProvider: this.options.modelProvider,
    });
  }
}
