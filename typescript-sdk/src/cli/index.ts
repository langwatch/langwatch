#!/usr/bin/env node

// Load environment variables BEFORE any other imports
import { config } from "dotenv";
config();

import { Command } from "commander";
import { parsePromptSpec } from "./types";

declare const __CLI_VERSION__: string;

// Import commands with proper async handling
const addCommand = async (name: string, options: { version?: string; localFile?: string }): Promise<void> => {
  const { addCommand: addCommandImpl } = await import("./commands/add.js");
  return addCommandImpl(name, options);
};

const removeCommand = async (name: string): Promise<void> => {
  const { removeCommand: removeCommandImpl } = await import("./commands/remove.js");
  return removeCommandImpl(name);
};

const initCommand = async (): Promise<void> => {
  const { initCommand: initCommandImpl } = await import("./commands/init.js");
  return initCommandImpl();
};

const loginCommand = async (): Promise<void> => {
  const { loginCommand: loginCommandImpl } = await import("./commands/login.js");
  return loginCommandImpl();
};

const listCommand = async (): Promise<void> => {
  const { listCommand: listCommandImpl } = await import("./commands/list.js");
  return listCommandImpl();
};

const syncCommand = async (): Promise<void> => {
  const { syncCommand: syncCommandImpl } = await import("./commands/sync.js");
  return syncCommandImpl();
};

const pullCommand = async (): Promise<void> => {
  const { pullCommand: pullCommandImpl } = await import("./commands/pull.js");
  return pullCommandImpl();
};

const pushCommand = async (options?: { forceLocal?: boolean; forceRemote?: boolean }): Promise<void> => {
  const { pushCommand: pushCommandImpl } = await import("./commands/push.js");
  return pushCommandImpl(options);
};

const createCommand = async (name: string, options: Record<string, unknown>): Promise<void> => {
  const { createCommand: createCommandImpl } = await import("./commands/create.js");
  return createCommandImpl(name, options);
};

// Dataset commands (lazy-loaded)
const datasetList = async (): Promise<void> => {
  const { datasetListCommand } = await import("./commands/dataset/list.js");
  return datasetListCommand();
};

const datasetCreate = async (name: string, options: { columns?: string }): Promise<void> => {
  const { datasetCreateCommand } = await import("./commands/dataset/create.js");
  return datasetCreateCommand(name, options);
};

const datasetGet = async (slugOrId: string): Promise<void> => {
  const { datasetGetCommand } = await import("./commands/dataset/get.js");
  return datasetGetCommand(slugOrId);
};

const datasetDelete = async (slugOrId: string): Promise<void> => {
  const { datasetDeleteCommand } = await import("./commands/dataset/delete.js");
  return datasetDeleteCommand(slugOrId);
};

const datasetUpload = async (slugOrIdOrFile: string, filePath: string | undefined, options: { create?: string }): Promise<void> => {
  const { datasetUploadCommand } = await import("./commands/dataset/upload.js");
  return datasetUploadCommand(slugOrIdOrFile, filePath, options);
};

const datasetDownload = async (slugOrId: string, options: { format?: string }): Promise<void> => {
  const { datasetDownloadCommand } = await import("./commands/dataset/download.js");
  return datasetDownloadCommand(slugOrId, options);
};

const program = new Command();

program
  .name("langwatch")
  .description("LangWatch CLI - Manage prompts and datasets")
  .version(__CLI_VERSION__, "-v, --version", "Display the current version")
  .configureHelp({
    showGlobalOptions: true,
  })
  .showHelpAfterError()
  .showSuggestionAfterError();

// Top-level commands
program
  .command("login")
  .description("Login to LangWatch and save API key")
  .action(async () => {
    try {
      await loginCommand();
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : "Unknown error"}`);
      process.exit(1);
    }
  });

// Add prompt command group
const promptCmd = program
  .command("prompt")
  .description("Manage prompt dependencies");

promptCmd
  .command("init")
  .description("Initialize a new prompts project")
  .action(async () => {
    try {
      await initCommand();
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : "Unknown error"}`);
      process.exit(1);
    }
  });

promptCmd
  .command("create <name>")
  .description("Create a new prompt YAML file with default content")
  .action(async (name: string) => {
    try {
      await createCommand(name, {});
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : "Unknown error"}`);
      process.exit(1);
    }
  });

promptCmd
  .command("add <spec> [localFile]")
  .description("Add a prompt dependency (e.g., 'agent/foo', 'agent/bar@5') or local file")
  .action(async (spec: string, localFile?: string) => {
    try {
      if (localFile) {
        await addCommand(spec, { localFile });
      } else {
        const { name, version } = parsePromptSpec(spec);
        await addCommand(name, { version });
      }
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : "Unknown error"}`);
      process.exit(1);
    }
  });

promptCmd
  .command("remove <name>")
  .description("Remove a prompt dependency")
  .action(async (name: string) => {
    try {
      await removeCommand(name);
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : "Unknown error"}`);
      process.exit(1);
    }
  });

promptCmd
  .command("list")
  .description("List all available prompts on the server")
  .action(async () => {
    try {
      await listCommand();
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : "Unknown error"}`);
      process.exit(1);
    }
  });

promptCmd
  .command("sync")
  .description("Sync prompts - fetch remote and push local")
  .action(async () => {
    try {
      await syncCommand();
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : "Unknown error"}`);
      process.exit(1);
    }
  });

promptCmd
  .command("pull")
  .description("Pull remote prompts and materialize locally")
  .action(async () => {
    try {
      await pullCommand();
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : "Unknown error"}`);
      process.exit(1);
    }
  });

promptCmd
  .command("push")
  .description("Push local prompts to the server")
  .option("--force-local", "Auto-resolve conflicts by keeping local version")
  .option("--force-remote", "Auto-resolve conflicts by keeping remote version")
  .action(async (options: { forceLocal?: boolean; forceRemote?: boolean }) => {
    try {
      await pushCommand({ forceLocal: options.forceLocal, forceRemote: options.forceRemote });
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : "Unknown error"}`);
      process.exit(1);
    }
  });

// Add dataset command group
const datasetCmd = program
  .command("dataset")
  .description("Manage datasets");

datasetCmd
  .command("list")
  .description("List all datasets")
  .action(async () => {
    try {
      await datasetList();
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : "Unknown error"}`);
      process.exit(1);
    }
  });

datasetCmd
  .command("create <name>")
  .description("Create a new dataset")
  .option("--columns <columns>", "Column definitions (e.g., input:string,output:string)")
  .action(async (name: string, options: { columns?: string }) => {
    try {
      await datasetCreate(name, options);
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : "Unknown error"}`);
      process.exit(1);
    }
  });

datasetCmd
  .command("get <slug>")
  .description("Get dataset details and preview records")
  .action(async (slug: string) => {
    try {
      await datasetGet(slug);
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : "Unknown error"}`);
      process.exit(1);
    }
  });

datasetCmd
  .command("delete <slug>")
  .description("Archive a dataset")
  .action(async (slug: string) => {
    try {
      await datasetDelete(slug);
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : "Unknown error"}`);
      process.exit(1);
    }
  });

datasetCmd
  .command("upload [slug] [file]")
  .description("Upload a CSV or JSONL file to a dataset")
  .option("--create <name>", "Create a new dataset from the file")
  .action(async (slug: string | undefined, file: string | undefined, options: { create?: string }) => {
    try {
      if (options.create) {
        // --create mode: first positional arg is the file path
        if (!slug) {
          console.error("Error: file path is required");
          process.exit(1);
        }
        await datasetUpload(slug, undefined, options);
      } else {
        if (!slug || !file) {
          console.error("Error: both <slug> and <file> are required");
          process.exit(1);
        }
        await datasetUpload(slug, file, options);
      }
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : "Unknown error"}`);
      process.exit(1);
    }
  });

datasetCmd
  .command("download <slug>")
  .description("Download dataset records as CSV or JSONL")
  .option("--format <format>", "Output format: csv or jsonl", "csv")
  .action(async (slug: string, options: { format?: string }) => {
    try {
      await datasetDownload(slug, options);
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : "Unknown error"}`);
      process.exit(1);
    }
  });

program.parse(process.argv);