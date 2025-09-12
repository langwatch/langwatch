import { type Prompt } from "@/client-sdk/services/prompts/prompt";
import { PromptYamlSerializer } from "./prompt-yaml-serializer";
import * as fs from "fs/promises";
import * as path from "path";

/**
 * Repository for managing local prompt files.
 * Handles both regular prompts (prompts/) and materialized prompts (.materialized/).
 * Uses shared logic with different directory paths.
 */
export class LocalPromptRepository {
  private static readonly PROMPTS_DIR = "prompts";
  private static readonly MATERIALIZED_DIR = ".materialized";

  /**
   * Save a prompt to the prompts/ directory
   */
  async savePrompt(name: string, prompt: Prompt): Promise<void> {
    await this._save(name, prompt, LocalPromptRepository.PROMPTS_DIR);
  }

  /**
   * Load a prompt from the prompts/ directory
   */
  async loadPrompt(name: string): Promise<Prompt | null> {
    return this._load(name, LocalPromptRepository.PROMPTS_DIR);
  }

  /**
   * Save a materialized prompt to the .materialized/ directory
   */
  async savePromptMaterialized(name: string, prompt: Prompt): Promise<void> {
    await this._save(name, prompt, LocalPromptRepository.MATERIALIZED_DIR);
  }

  /**
   * Load a materialized prompt from the .materialized/ directory
   */
  async loadPromptMaterialized(name: string): Promise<Prompt | null> {
    return this._load(name, LocalPromptRepository.MATERIALIZED_DIR);
  }

  /**
   * Shared save logic - serializes prompt and writes to specified directory
   */
  private async _save(name: string, prompt: Prompt, directory: string): Promise<void> {
    const filePath = this._getFilePath(name, directory);

    // Ensure directory exists
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    // Serialize and save
    const yamlContent = PromptYamlSerializer.serialize(prompt);
    await fs.writeFile(filePath, yamlContent, "utf-8");
  }

  /**
   * Shared load logic - reads file and deserializes to Prompt
   */
  private async _load(name: string, directory: string): Promise<Prompt | null> {
    const filePath = this._getFilePath(name, directory);

    try {
      const yamlContent = await fs.readFile(filePath, "utf-8");
      return PromptYamlSerializer.deserialize(yamlContent, {
        handle: name,
      });
    } catch {
      // File doesn't exist or can't be read
      return null;
    }
  }

  /**
   * Gets the full file path for a prompt
   */
  private _getFilePath(name: string, directory: string): string {
    return path.join(directory, `${name}.prompt.yaml`);
  }
}
