/**
 * The Prompt feature's test seam: the real prompt service over the Prisma
 * client a caller already opened, so another module's integration test reads
 * back the prompt versions it wrote rather than a double's idea of them.
 */
import type { PromptService } from "../services/prompt.service.ts";
import { PostgresPromptAdapter, type PromptPersistence } from "../app/prompt-composition.build.ts";

export function promptServiceFixture({ database }: { database: PromptPersistence }): PromptService {
  return PostgresPromptAdapter.create({ database }).build();
}
