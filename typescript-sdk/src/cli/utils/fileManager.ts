import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import chalk from "chalk";
import { z } from "zod";
import type { PromptsConfig, LocalPromptConfig, MaterializedPrompt, PromptsLock, PromptsLockEntry } from "../types";
import { localPromptConfigSchema } from "../types";
import { PromptConverter } from "../../prompt/converter";

export class FileManager {
  private static readonly PROMPTS_CONFIG_FILE = "prompts.json";
  private static readonly PROMPTS_LOCK_FILE = "prompts-lock.json";
  private static readonly PROMPTS_DIR = "prompts";
  private static readonly MATERIALIZED_DIR = ".materialized";

  static getPromptsConfigPath(): string {
    return path.join(process.cwd(), this.PROMPTS_CONFIG_FILE);
  }

  static getPromptsLockPath(): string {
    return path.join(process.cwd(), this.PROMPTS_LOCK_FILE);
  }

  static getPromptsDir(): string {
    return path.join(process.cwd(), this.PROMPTS_DIR);
  }

  static getMaterializedDir(): string {
    return path.join(this.getPromptsDir(), this.MATERIALIZED_DIR);
  }

  static ensureDirectories(): void {
    const promptsDir = this.getPromptsDir();
    const materializedDir = this.getMaterializedDir();

    if (!fs.existsSync(promptsDir)) {
      fs.mkdirSync(promptsDir, { recursive: true });
    }

    if (!fs.existsSync(materializedDir)) {
      fs.mkdirSync(materializedDir, { recursive: true });
    }
  }

  static loadPromptsConfig(): PromptsConfig {
    const configPath = this.getPromptsConfigPath();

    if (!fs.existsSync(configPath)) {
      return { prompts: {} };
    }

    try {
      const content = fs.readFileSync(configPath, "utf-8");
      return JSON.parse(content) as PromptsConfig;
    } catch (error) {
      throw new Error(`Failed to parse prompts.json: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  static savePromptsConfig(config: PromptsConfig): void {
    const configPath = this.getPromptsConfigPath();
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
  }

  static initializePromptsConfig(): { created: boolean; path: string } {
    const configPath = this.getPromptsConfigPath();
    const existed = fs.existsSync(configPath);

    if (!existed) {
      const emptyConfig: PromptsConfig = { prompts: {} };
      this.savePromptsConfig(emptyConfig);
      return { created: true, path: configPath };
    }

    return { created: false, path: configPath };
  }

  static loadPromptsLock(): PromptsLock {
    const lockPath = this.getPromptsLockPath();

    if (!fs.existsSync(lockPath)) {
      return {
        lockfileVersion: 1,
        prompts: {}
      };
    }

    try {
      const content = fs.readFileSync(lockPath, "utf-8");
      return JSON.parse(content) as PromptsLock;
    } catch (error) {
      throw new Error(`Failed to parse prompts-lock.json: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  static savePromptsLock(lock: PromptsLock): void {
    const lockPath = this.getPromptsLockPath();
    fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + "\n");
  }

  static initializePromptsLock(): { created: boolean; path: string } {
    const lockPath = this.getPromptsLockPath();
    const existed = fs.existsSync(lockPath);

    if (!existed) {
      const emptyLock: PromptsLock = {
        lockfileVersion: 1,
        prompts: {}
      };
      this.savePromptsLock(emptyLock);
      return { created: true, path: lockPath };
    }

    return { created: false, path: lockPath };
  }

  static loadLocalPrompt(filePath: string): LocalPromptConfig {
    const fullPath = path.resolve(filePath);

    if (!fs.existsSync(fullPath)) {
      throw new Error(`Local prompt file not found: ${filePath}`);
    }

    try {
      const content = fs.readFileSync(fullPath, "utf-8");
      const rawData = yaml.load(content);

      // Validate with zod and provide nice error messages
      const result = localPromptConfigSchema.safeParse(rawData);

            if (!result.success) {
        // Format zod errors nicely (manually since z.prettifyError might not be available)
        const prettyError = result.error.issues
          .map(issue => `✖ ${issue.message}${issue.path.length > 0 ? `\n  → at ${issue.path.join('.')}` : ''}`)
          .join('\n');

        throw new Error(
          `Invalid prompt configuration in ${chalk.yellow(filePath)}:\n${prettyError}`
        );
      }

      return result.data;
    } catch (error) {
      if (error instanceof Error && error.message.includes("Invalid prompt configuration")) {
        throw error; // Re-throw zod validation errors as-is
      }
      throw new Error(`Failed to parse local prompt file ${filePath}: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

    static saveMaterializedPrompt(name: string, prompt: MaterializedPrompt): string {
    const materializedDir = this.getMaterializedDir();
    const parts = name.split("/");
    const fileName = `${parts[parts.length - 1]}.prompt.yaml`;

    // Create nested directories if needed
    if (parts.length > 1) {
      const subDir = path.join(materializedDir, ...parts.slice(0, -1));
      if (!fs.existsSync(subDir)) {
        fs.mkdirSync(subDir, { recursive: true });
      }
    }

    const filePath = path.join(materializedDir, ...parts.slice(0, -1), fileName);

    // Convert to YAML format using the converter
    const yamlContent = PromptConverter.fromMaterializedToYaml(prompt);

    const yamlString = yaml.dump(yamlContent, {
      lineWidth: -1,
      noRefs: true,
      sortKeys: false
    });

    fs.writeFileSync(filePath, yamlString);
    return filePath;
  }

  static getLocalPromptFiles(): string[] {
    const promptsDir = this.getPromptsDir();
    const materializedDir = this.getMaterializedDir();

    if (!fs.existsSync(promptsDir)) {
      return [];
    }

    const files: string[] = [];

    const walkDir = (dir: string, relativePath = ""): void => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relativeFilePath = path.join(relativePath, entry.name);

        if (entry.isDirectory()) {
          // Skip the .materialized directory
          if (fullPath === materializedDir) {
            continue;
          }
          walkDir(fullPath, relativeFilePath);
        } else if (entry.isFile() && entry.name.endsWith(".prompt.yaml")) {
          files.push(path.join(promptsDir, relativeFilePath));
        }
      }
    };

    walkDir(promptsDir);
    return files;
  }

  static promptNameFromPath(filePath: string): string {
    const promptsDir = this.getPromptsDir();
    const relativePath = path.relative(promptsDir, filePath);
    return relativePath.replace(/\.prompt\.yaml$/, "");
  }

  static cleanupOrphanedMaterializedFiles(currentDependencies: Set<string>): string[] {
    const materializedDir = this.getMaterializedDir();

    if (!fs.existsSync(materializedDir)) {
      return [];
    }

    const cleaned: string[] = [];

    const cleanupDir = (dir: string, relativePath = ""): void => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relativeFilePath = path.join(relativePath, entry.name);

        if (entry.isDirectory()) {
          cleanupDir(fullPath, relativeFilePath);

          // Remove empty directories
          try {
            const dirEntries = fs.readdirSync(fullPath);
            if (dirEntries.length === 0) {
              fs.rmdirSync(fullPath);
            }
          } catch {
            // Directory not empty or other error, ignore
          }
        } else if (entry.isFile() && entry.name.endsWith(".prompt.yaml")) {
          // Extract prompt name from materialized file path
          const promptName = relativeFilePath.replace(/\.prompt\.yaml$/, "");

          if (!currentDependencies.has(promptName)) {
            fs.unlinkSync(fullPath);
            cleaned.push(promptName);
          }
        }
      }
    };

    cleanupDir(materializedDir);
    return cleaned;
  }

  static updateLockEntry(lock: PromptsLock, name: string, prompt: MaterializedPrompt, materializedPath: string): void {
    const relativePath = path.relative(process.cwd(), materializedPath);

    lock.prompts[name] = {
      version: prompt.version,
      versionId: prompt.versionId,
      materialized: relativePath,
    };
  }

  static removeFromLock(lock: PromptsLock, names: string[]): void {
    for (const name of names) {
      delete lock.prompts[name];
    }
  }

  static addToGitignore(entry: string): { added: boolean; existed: boolean } {
    const gitignorePath = path.join(process.cwd(), ".gitignore");

    // Check if .gitignore exists
    if (!fs.existsSync(gitignorePath)) {
      // Create new .gitignore with the entry
      fs.writeFileSync(gitignorePath, `${entry}\n`);
      return { added: true, existed: false };
    }

    // Read existing .gitignore
    const content = fs.readFileSync(gitignorePath, "utf-8");
    const lines = content.split("\n").map(line => line.trim());

    // Check if entry already exists
    if (lines.includes(entry)) {
      return { added: false, existed: true };
    }

    // Add entry to .gitignore
    const newContent = content.endsWith("\n") ? `${content}${entry}\n` : `${content}\n${entry}\n`;
    fs.writeFileSync(gitignorePath, newContent);

    return { added: true, existed: false };
  }
}