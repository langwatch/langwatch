import * as path from "path";
import chalk from "chalk";
import ora from "ora";
import { FileManager } from "../utils/fileManager";
import { PromptService, PromptsError } from "../../prompt/service";
import { PromptConverter } from "../../prompt/converter";
import type { SyncResult } from "../types";

export const syncCommand = async (): Promise<void> => {
  const startTime = Date.now();

  try {
    // Get prompt service
    const promptService = PromptService.getInstance();

    // Ensure directories exist
    FileManager.ensureDirectories();

    // Load prompts config
    const config = FileManager.loadPromptsConfig();

    const result: SyncResult = {
      fetched: [],
      pushed: [],
      unchanged: [],
      errors: [],
    };

    // Process remote prompts (fetch and materialize)
    const remoteDeps = Object.entries(config.prompts).filter(([, dependency]) => {
      // Skip local file dependencies (both object format and string format)
      if (typeof dependency === "object" && dependency.file) {
        return false;
      }
      if (typeof dependency === "string" && dependency.startsWith("file:")) {
        return false;
      }
      return true;
    });

    if (remoteDeps.length > 0) {
      const fetchSpinner = ora(`Fetching ${remoteDeps.length} remote prompts...`).start();

      for (const [name, dependency] of remoteDeps) {
        try {
          const versionSpec = typeof dependency === "string" ? dependency : dependency.version || "latest";

          // Fetch the prompt from the API
          const prompt = await promptService.get(name);

                    if (prompt) {
            // Convert to MaterializedPrompt format using the converter
            const materializedPrompt = PromptConverter.fromApiToMaterialized(prompt);

            const savedPath = FileManager.saveMaterializedPrompt(name, materializedPrompt);
            const relativePath = path.relative(process.cwd(), savedPath);
            result.fetched.push(name); // Store the name, not path

            fetchSpinner.text = `Fetched ${chalk.cyan(`${name}@${versionSpec}`)} ${chalk.gray(`(version ${prompt.version})`)} → ${chalk.gray(relativePath)}`;
          } else {
            result.errors.push({ name, error: "Prompt not found" });
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "Unknown error";
          result.errors.push({ name, error: errorMessage });
        }
      }

      fetchSpinner.stop();
    }

    // Process local prompts (push to API)
    // 1. First process files referenced in prompts.json with "file:" prefix
    const localFileRefs = Object.entries(config.prompts).filter(([, dependency]) => {
      return typeof dependency === "string" && dependency.startsWith("file:");
    });

    // 2. Also get files discovered by FileManager
    const discoveredLocalFiles = FileManager.getLocalPromptFiles();

    const allLocalWork = [...localFileRefs, ...discoveredLocalFiles.map(f => [FileManager.promptNameFromPath(f), f])];

    if (allLocalWork.length > 0) {
      const pushSpinner = ora(`Pushing ${allLocalWork.length} local prompts...`).start();

      for (const [promptName, filePathOrDep] of allLocalWork) {
        try {
          // Handle both file: references and discovered files
          let filePath: string;
          if (typeof filePathOrDep === "string" && filePathOrDep.startsWith("file:")) {
            filePath = filePathOrDep.slice(5); // Remove "file:" prefix
          } else {
            filePath = filePathOrDep as string;
            // Skip if this prompt is defined in prompts.json as a remote dependency
            if (config.prompts[promptName] && typeof config.prompts[promptName] === "string" && !config.prompts[promptName].startsWith("file:")) {
              continue;
            }
          }

                    // Load local prompt config
          const localConfig = FileManager.loadLocalPrompt(filePath);

          // Convert local config to API format and push using PromptService.upsert
          const apiConfig = PromptConverter.fromLocalToApiFormat(localConfig);
          const upsertResult = await promptService.upsert(promptName, apiConfig);

          const relativePath = path.relative(process.cwd(), filePath);
          result.pushed.push(promptName); // Store the name, not path

          const action = upsertResult.created ? "Created" : "Updated";
          pushSpinner.text = `${action} ${chalk.cyan(promptName)} ${chalk.gray(`(version ${upsertResult.prompt.version})`)} from ${chalk.gray(relativePath)}`;

        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "Unknown error";
          result.errors.push({ name: promptName, error: errorMessage });
        }
      }

      pushSpinner.stop();
    }

    // Print individual results if there were actions
    if (result.fetched.length > 0) {
      for (const name of result.fetched) {
        const parts = name.split("/");
        const fileName = `${parts[parts.length - 1]}.prompt.yaml`;
        const materializedPath = parts.length > 1
          ? `./prompts/.materialized/${parts.slice(0, -1).join("/")}/${fileName}`
          : `./prompts/.materialized/${fileName}`;
        console.log(chalk.green(`✓ Pulled ${chalk.cyan(name)} → ${chalk.gray(materializedPath)}`));
      }
    }

    if (result.pushed.length > 0) {
      for (const name of result.pushed) {
        const localPath = `./prompts/${name}.prompt.yaml`;
        console.log(chalk.green(`✓ Pushed ${chalk.cyan(name)} from ${chalk.gray(localPath)}`));
      }
    }

    // Print errors
    if (result.errors.length > 0) {
      for (const { name, error } of result.errors) {
        console.log(chalk.red(`✗ Failed ${chalk.cyan(name)}: ${error}`));
      }
    }

    // Print summary
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    const totalActions = result.fetched.length + result.pushed.length;

    if (totalActions === 0 && result.errors.length === 0) {
      console.log(chalk.gray(`Synced in ${duration}s`));
    } else {
      const summary = [];
      if (result.fetched.length > 0) summary.push(`${result.fetched.length} fetched`);
      if (result.pushed.length > 0) summary.push(`${result.pushed.length} pushed`);
      if (result.errors.length > 0) summary.push(`${result.errors.length} errors`);

      console.log(chalk.gray(`Synced ${summary.join(', ')} in ${duration}s`));
    }

    if (result.errors.length > 0) {
      process.exit(1);
    }

  } catch (error) {
    if (error instanceof PromptsError) {
      console.error(chalk.red(`Error: ${error.message}`));
    } else {
      console.error(chalk.red(`Unexpected error: ${error instanceof Error ? error.message : "Unknown error"}`));
    }
    process.exit(1);
  }
};