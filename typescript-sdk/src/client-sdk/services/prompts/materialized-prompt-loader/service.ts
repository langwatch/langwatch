import { FileManager } from "@/cli/utils/fileManager";
import { MaterializedPromptReader } from "@/shared/utils/materialized-prompt-reader";
import type { MaterializedPrompt } from "@/cli/types";

/**
 * Service responsible for loading all materialized prompts from the filesystem.
 * Orchestrates FileManager for file discovery and MaterializedPromptReader for parsing.
 * Uses async/parallel operations for maximum efficiency.
 */
export class MaterializedPromptLoaderService {
  private isLoaded = false;
  private prompts = new Map<string, MaterializedPrompt>();

  /**
   * Loads all materialized prompts from the .materialized directory in parallel.
   * Populates internal cache for fast retrieval.
   *
   * @returns Promise resolving to array of all loaded MaterializedPrompt objects
   */
  async load(): Promise<Map<string, MaterializedPrompt>> {
    const materializedFiles = FileManager.getMaterializedPromptFiles();
    this.prompts = await MaterializedPromptReader.readMaterializedPrompts(materializedFiles);

    this.isLoaded = true;

    return this.prompts;
  }

  /**
   * Gets a specific materialized prompt by name.
   * Must call load() first to populate the cache.
   *
   * @param name - The prompt name to retrieve
   * @returns MaterializedPrompt if found, null otherwise
   */
  get(name: string): MaterializedPrompt | null {
    if (!this.isLoaded) {
      throw new Error("Materialized prompts not loaded. Call load() first.");
    }

    return this.prompts.get(name) ?? null;
  }
}
