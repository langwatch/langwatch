import type { LocalPromptConfig, PromptDependency } from "@/cli/types";
import { FileManager } from "@/cli/utils/fileManager";
import { type Logger, NoOpLogger } from "@/logger";
import { type PromptData } from "./types";
import { PromptFileNotFoundError } from "@/cli/utils/errors/prompt-not-found.error";

export interface LocalPromptsServiceConfig {
  fileManager?: typeof FileManager;
  logger?: Logger;
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
  private readonly logger: Logger;

  constructor(config?: LocalPromptsServiceConfig) {
    this.fileManager = config?.fileManager ?? FileManager;
    this.logger = config?.logger ?? new NoOpLogger();
  }

  /**
   * Retrieves a prompt using the configured search strategy.
   * Tries each source in priority order until found or all sources exhausted.
   */
  async get(handleOrId: string): Promise<PromptData | null> {
    try {
      const dependency = await this.getDependencyFromConfig(handleOrId);

      // If no dependency is found, it means it's not a local prompt
      if (!dependency) {
        return null;
      }

      // Try each source in priority order until found or all sources exhausted
      // We catch errors and return null if any of the sources fail so we
      // can continue to the next source and return null if all sources fail
      const localPromptConfig = (
        (await this.getFromConfig(dependency).catch((e) => {
          if (e instanceof PromptFileNotFoundError) return null;
          throw e;
        })) ??
        (await this.getFromLockFile(handleOrId).catch((e) => {
          if (e instanceof PromptFileNotFoundError) return null;
          throw e;
        })) ??
        (await this.getFromLocalFiles(handleOrId).catch((e) => {
          if (e instanceof PromptFileNotFoundError) return null;
          throw e;
        }))
      );

      return localPromptConfig ? this.convertToPromptData({
        ...localPromptConfig,
        handle: handleOrId,
      }) : null;
    } catch (error) {
      this.logger.warn(`Failed to get prompt "${handleOrId}": ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }


  /**
   * Searches for prompt using explicit file mapping in prompts.json.
   * Looks for dependencies with a 'file' property pointing to a specific path.
   */
  private async getFromConfig(dependency: PromptDependency): Promise<LocalPromptConfig | null> {
    if (typeof dependency === 'string' && dependency.startsWith('file:')) {
      return this.fileManager.loadLocalPrompt(dependency.slice(5));
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

  /**
   * Get dependency from config
   */
  private async getDependencyFromConfig(handleOrId: string): Promise<PromptDependency | null> {
    const config = this.fileManager.loadPromptsConfig();
    const dependency = config.prompts[handleOrId];

    return dependency ?? null;
  }

  /**
   * Converts LocalPromptConfig to PromptData format
   */
  private convertToPromptData(config: LocalPromptConfig & { handle: string; }): PromptData {
    const { modelParameters, ...rest } = config;
    return {
      maxTokens: modelParameters?.max_tokens,
      temperature: modelParameters?.temperature,
      ...rest,
    };
  }
}
