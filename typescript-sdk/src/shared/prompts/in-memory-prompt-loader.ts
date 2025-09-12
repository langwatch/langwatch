import { type Prompt } from "@/client-sdk/services/prompts/prompt";
import { LocalPromptRepository } from "./local-prompt.repository";

/**
 * Error thrown when a prompt exists in both regular and materialized directories
 */
export class DuplicatePromptFoundError extends Error {
  constructor(promptName: string) {
    super(`Duplicate prompt found: '${promptName}' exists in both prompts/ and .materialized/ directories`);
    this.name = 'DuplicatePromptError';
  }
}


/**
 * In-memory prompt loader that provides a simple facade over the repository.
 * For now, reads directly from filesystem (no caching optimization).
 * Future optimizations: memory caching, file watching, bulk loading.
 */
export class InMemoryPromptLoader {
  private repository = new LocalPromptRepository();

  /**
   * Gets a prompt by name, checking both regular and materialized directories.
   * Returns the first match found.
   */
  async get(name: string): Promise<Prompt | null> {
    const [regularPrompt, materializedPrompt] = await Promise.all([
      this.repository.loadPrompt(name),
      this.repository.loadPromptMaterialized(name)
    ]);

    if (regularPrompt && materializedPrompt) {
      throw new DuplicatePromptFoundError(name);
    }

    return regularPrompt ?? materializedPrompt;
  }
}
