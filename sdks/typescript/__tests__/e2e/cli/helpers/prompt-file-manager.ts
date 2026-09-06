import * as fs from "fs";
import * as path from "path";
import * as yaml from "yaml";

export interface PromptConfig {
  model: string;
  modelParameters?: {
    temperature?: number;
    maxTokens?: number;
    [key: string]: any;
  };
  messages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }>;
  [key: string]: any;
}

/**
 * Manages prompt YAML files.
 *
 * Responsibilities:
 * - Create and update prompt YAML files
 * - Read prompt file contents
 * - Handle YAML parsing and serialization
 * - Manage prompts directory structure
 */
export class PromptFileManager {
  constructor(
    private readonly config: { cwd: string; materializedDir?: boolean },
  ) {}

  /**
   * Gets the absolute path to a prompt file.
   */
  getPromptFilePath(name: string): string {
    return path.join(
      this.config.cwd,
      this.config.materializedDir ? "prompts/.materialized" : "prompts",
      `${name}.prompt.yaml`,
    );
  }

  /**
   * Updates an existing prompt file by merging with new configuration.
   * @param name Prompt name (without extension)
   * @param updates Partial configuration to merge
   * @returns Absolute path to the updated file
   */
  updatePromptFile(name: string, updates: Partial<PromptConfig>): string {
    const filePath = this.getPromptFilePath(name);

    if (!fs.existsSync(filePath)) {
      throw new Error(`Prompt file not found: ${filePath}`);
    }

    const existingContent = fs.readFileSync(filePath, "utf8");
    const existingConfig = yaml.parse(existingContent) as PromptConfig;

    const updatedConfig = {
      ...existingConfig,
      ...updates,
      modelParameters: {
        ...existingConfig.modelParameters,
        ...updates.modelParameters,
      },
    };

    const yamlContent = yaml.stringify(updatedConfig);
    fs.writeFileSync(filePath, yamlContent);
    return filePath;
  }

  /**
   * Reads the content of a prompt file as a string.
   * @param name Prompt name (without extension)
   * @returns File content as string
   */
  getPromptFileContent(name: string): string {
    const filePath = this.getPromptFilePath(name);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Prompt file not found: ${filePath}`);
    }
    return fs.readFileSync(filePath, "utf8");
  }

  /**
   * Reads and parses a prompt file as a configuration object.
   * @param name Prompt name (without extension)
   * @returns Parsed prompt configuration
   */
  readPromptFile(name: string): PromptConfig {
    const content = this.getPromptFileContent(name);
    return yaml.parse(content) as PromptConfig;
  }
}
