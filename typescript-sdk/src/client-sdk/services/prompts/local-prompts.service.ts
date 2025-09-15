import type { LocalPromptConfig } from "@/cli/types";
import { FileManager } from "@/cli/utils/fileManager";

export interface LocalPromptsServiceConfig {
  fileManager: typeof FileManager;
}

/**
 * Service for retrieving prompts from local filesystem sources.
 *
 * Searches for prompts in the following priority order:
 * 1. Explicit file mapping in prompts.json config
 * 2. Materialized path from prompts-lock.json
 * 3. Direct file scanning in prompts directory
 */
export class LocalPromptsService {
  private readonly fileManager: typeof FileManager;

  constructor(config: LocalPromptsServiceConfig = { fileManager: FileManager }) {
    this.fileManager = config.fileManager;
  }

  /**
   * Retrieves a prompt using the configured search strategy.
   * Tries each source in priority order until found or all sources exhausted.
   */
  async get(handleOrId: string): Promise<LocalPromptConfig | null> {
    try {
      return (
        (await this.getFromConfig(handleOrId)) ??
        (await this.getFromLockFile(handleOrId)) ??
        (await this.getFromLocalFiles(handleOrId))
      );
    } catch (_error) {
      return null;
    }
  }

  /**
   * Searches for prompt using explicit file mapping in prompts.json.
   * Looks for dependencies with a 'file' property pointing to a specific path.
   */
  private async getFromConfig(handleOrId: string): Promise<LocalPromptConfig | null> {
    const config = this.fileManager.loadPromptsConfig();
    const dependency = config.prompts[handleOrId];

    if (dependency && typeof dependency === 'object' && dependency.file) {
      return this.fileManager.loadLocalPrompt(dependency.file);
    }

    return null;
  }

  /**
   * Searches for prompt using materialized path from lock file.
   * Lock file contains resolved paths for prompts that have been synced/materialized.
   */
  private async getFromLockFile(handleOrId: string): Promise<LocalPromptConfig | null> {
    const lock = this.fileManager.loadPromptsLock();
    const lockEntry = lock.prompts[handleOrId];

    if (lockEntry?.materialized) {
      return this.fileManager.loadLocalPrompt(lockEntry.materialized);
    }

    return null;
  }

  /**
   * Searches for prompt by scanning all .prompt.yaml files in prompts directory.
   * Extracts prompt name from file path and matches against the requested handle.
   * This is the fallback method when explicit mappings don't exist.
   */
  private async getFromLocalFiles(handleOrId: string): Promise<LocalPromptConfig | null> {
    const localFiles = this.fileManager.getLocalPromptFiles();

    for (const filePath of localFiles) {
      const promptName = this.fileManager.promptNameFromPath(filePath);
      if (promptName === handleOrId) {
        return this.fileManager.loadLocalPrompt(filePath);
      }
    }

    return null;
  }
}
