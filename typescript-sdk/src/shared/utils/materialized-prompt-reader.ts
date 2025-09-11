import * as fs from "fs/promises";
import * as yaml from "js-yaml";
import type { LocalPromptConfig, MaterializedPrompt } from "@/cli/types";
import { FileManager } from "@/cli/utils/fileManager";
import { PromptConverter } from "@/cli/utils/promptConverter";

/**
 * Responsible for reading and parsing materialized prompt files from disk.
 * Follows SRP by focusing solely on file reading and YAML parsing operations.
 * Uses async operations for better performance.
 */
export class MaterializedPromptReader {
  /**
   * Reads and parses materialized prompt files asynchronously.
   * Returns a Map with file paths as keys and MaterializedPrompt objects as values.
   *
   * @param filePaths - Array of absolute paths to .prompt.yaml files
   * @returns Promise resolving to Map<string, MaterializedPrompt>
   * @throws {Error} If any file doesn't exist, cannot be read, or YAML parsing fails
   */
  static async readMaterializedPrompts(filePaths: string[]): Promise<Map<string, MaterializedPrompt>> {
    // Process all files in parallel for maximum efficiency
    const prompts = await Promise.all(filePaths.map(async filePath => ({
      path: filePath,
      name: FileManager.promptNameFromMaterializedPath(filePath),
      prompt: await this.readSinglePrompt(filePath)
    })));

    const promptMap = new Map<string, MaterializedPrompt>();

    prompts.forEach(({ name, prompt }) => {
      promptMap.set(name, prompt);
    });

    return promptMap;
  }

  /**
   * Reads and parses a single materialized prompt file asynchronously.
   * Private helper method to avoid code duplication.
   *
   * @param filePath - Absolute path to the .prompt.yaml file
   * @returns Promise resolving to parsed MaterializedPrompt object
   * @throws {Error} If file doesn't exist, cannot be read, or YAML parsing fails
   */
  static async readSinglePrompt(filePath: string): Promise<MaterializedPrompt> {
    try {
      const content = await fs.readFile(filePath, "utf-8");
      const yamlData = yaml.load(content) as LocalPromptConfig;

      // TODO: Add validation schema if needed
      return {
        model: yamlData.model,
        temperature: yamlData.modelParameters?.temperature,
        maxTokens: yamlData.modelParameters?.max_tokens,
        messages: yamlData.messages,
        prompt: PromptConverter.extractSystemPrompt(yamlData.messages),
      }
    } catch (error) {
      throw new Error(`Failed to parse materialized prompt file ${filePath}: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }
}
