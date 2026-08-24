import { PostgresPromptAdapter } from "@langwatch/prompt-server";
import type { ModelProviderService } from "@langwatch/model-provider-contract";
import type { PrismaClient } from "~/generated/prisma/client";

/** Composition entry point for the process-owned Prompt capability. */
export class AppPromptRuntime {
  private constructor(
    private readonly options: {
      database: PrismaClient;
      modelProvider: ModelProviderService;
    },
  ) {}

  static create(options: {
    database: PrismaClient;
    modelProvider: ModelProviderService;
  }): AppPromptRuntime {
    return new AppPromptRuntime(options);
  }

  build() {
    return PostgresPromptAdapter.create(this.options).build();
  }
}
