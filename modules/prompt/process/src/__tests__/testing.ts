/**
 * The Prompt feature's test seam: the real prompt service over the Prisma
 * client a caller already opened, so another module's integration test reads
 * back the prompt versions it wrote rather than a double's idea of them.
 */
import type { ModelProviderApi } from "@langwatch/model-provider-contract";

import { PostgresPromptAdapter, type PromptPersistence } from "../app/prompt-composition.build.ts";
import type { PromptService } from "../services/prompt.service.ts";

export function promptServiceFixture({
  database,
  modelProviders,
}: {
  database: PromptPersistence;
  modelProviders: ModelProviderApi;
}): PromptService {
  return PostgresPromptAdapter.create({ database, modelProviders }).build();
}
