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

const pullCommand = async (options?: { tag?: string }): Promise<void> => {
  const { pullCommand: pullCommandImpl } = await import("./commands/pull.js");
  return pullCommandImpl(options);
};

// Tag commands
const tagListCommand = async (): Promise<void> => {
  const { tagListCommand: impl } = await import("./commands/tag/list.js");
  return impl();
};

const tagCreateCommand = async (name: string): Promise<void> => {
  const { tagCreateCommand: impl } = await import("./commands/tag/create.js");
  return impl(name);
};

const tagRenameCommand = async (oldName: string, newName: string): Promise<void> => {
  const { tagRenameCommand: impl } = await import("./commands/tag/rename.js");
  return impl(oldName, newName);
};

const tagAssignCommand = async (promptHandle: string, tagName: string, options?: { version?: string }): Promise<void> => {
  const { tagAssignCommand: impl } = await import("./commands/tag/assign.js");
  return impl(promptHandle, tagName, options);
};

const tagDeleteCommand = async (tagName: string, options?: { force?: boolean }): Promise<void> => {
  const { tagDeleteCommand: impl } = await import("./commands/tag/delete.js");
  return impl(tagName, options);
};

const pushCommand = async (options?: { forceLocal?: boolean; forceRemote?: boolean }): Promise<void> => {
  const { pushCommand: pushCommandImpl } = await import("./commands/push.js");
  return pushCommandImpl(options);
};

const createCommand = async (name: string, options: Record<string, unknown>): Promise<void> => {
  const { createCommand: createCommandImpl } = await import("./commands/create.js");
  return createCommandImpl(name, options);
};

// Evaluator commands
const listEvaluatorsCommand = async (): Promise<void> => {
  const { listEvaluatorsCommand: impl } = await import("./commands/evaluators/list.js");
  return impl();
};

const getEvaluatorCommand = async (idOrSlug: string): Promise<void> => {
  const { getEvaluatorCommand: impl } = await import("./commands/evaluators/get.js");
  return impl(idOrSlug);
};

const createEvaluatorCommand = async (name: string, options: { type: string }): Promise<void> => {
  const { createEvaluatorCommand: impl } = await import("./commands/evaluators/create.js");
  return impl(name, options);
};

const deleteEvaluatorCommand = async (idOrSlug: string): Promise<void> => {
  const { deleteEvaluatorCommand: impl } = await import("./commands/evaluators/delete.js");
  return impl(idOrSlug);
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
  .option("--tag <name>", "Pull the version pointed to by this tag instead of the configured version")
  .action(async (options: { tag?: string }) => {
    try {
      await pullCommand(options);
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

// Add prompt tag subcommand group
const tagCmd = promptCmd
  .command("tag")
  .description("Manage prompt tags");

tagCmd
  .command("list")
  .description("List all tag definitions for the organization")
  .action(async () => {
    try {
      await tagListCommand();
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : "Unknown error"}`);
      process.exit(1);
    }
  });

tagCmd
  .command("create <name>")
  .description("Create a custom tag")
  .action(async (name: string) => {
    try {
      await tagCreateCommand(name);
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : "Unknown error"}`);
      process.exit(1);
    }
  });

tagCmd
  .command("rename <oldName> <newName>")
  .description("Rename a tag")
  .action(async (oldName: string, newName: string) => {
    try {
      await tagRenameCommand(oldName, newName);
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : "Unknown error"}`);
      process.exit(1);
    }
  });

tagCmd
  .command("assign <prompt> <tag>")
  .description("Assign a tag to a prompt version")
  .option("--version <number>", "Version number to assign (defaults to latest)")
  .action(async (prompt: string, tag: string, options: { version?: string }) => {
    try {
      await tagAssignCommand(prompt, tag, options);
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : "Unknown error"}`);
      process.exit(1);
    }
  });

tagCmd
  .command("delete <name>")
  .description("Delete a tag and remove all its assignments")
  .option("--force", "Skip confirmation prompt")
  .action(async (name: string, options: { force?: boolean }) => {
    try {
      await tagDeleteCommand(name, options);
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : "Unknown error"}`);
      process.exit(1);
    }
  });

// Add evaluator command group
const evaluatorCmd = program
  .command("evaluator")
  .description("Manage evaluator definitions");

evaluatorCmd
  .command("list")
  .description("List all evaluators in the project")
  .action(async () => {
    try {
      await listEvaluatorsCommand();
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : "Unknown error"}`);
      process.exit(1);
    }
  });

evaluatorCmd
  .command("get <idOrSlug>")
  .description("Get evaluator details by ID or slug")
  .action(async (idOrSlug: string) => {
    try {
      await getEvaluatorCommand(idOrSlug);
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : "Unknown error"}`);
      process.exit(1);
    }
  });

evaluatorCmd
  .command("create <name>")
  .description("Create a new evaluator")
  .requiredOption("--type <evaluatorType>", "Evaluator type (e.g. langevals/llm_judge)")
  .action(async (name: string, options: { type: string }) => {
    try {
      await createEvaluatorCommand(name, options);
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : "Unknown error"}`);
      process.exit(1);
    }
  });

evaluatorCmd
  .command("delete <idOrSlug>")
  .description("Archive (soft-delete) an evaluator")
  .action(async (idOrSlug: string) => {
    try {
      await deleteEvaluatorCommand(idOrSlug);
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
    const { listCommand: listDatasetsImpl } = await import("./commands/dataset/list.js");
    await listDatasetsImpl();
  });

datasetCmd
  .command("create <name>")
  .description("Create a new dataset")
  .option("-c, --columns <columns>", "Column definitions (e.g. input:string,output:string)")
  .action(async (name: string, options: { columns?: string }) => {
    const { createCommand: createDatasetImpl } = await import("./commands/dataset/create.js");
    await createDatasetImpl(name, options);
  });

datasetCmd
  .command("get <slugOrId>")
  .description("Get dataset details and preview records")
  .action(async (slugOrId: string) => {
    const { getCommand: getDatasetImpl } = await import("./commands/dataset/get.js");
    await getDatasetImpl(slugOrId);
  });

datasetCmd
  .command("delete <slugOrId>")
  .description("Delete (archive) a dataset")
  .action(async (slugOrId: string) => {
    const { deleteCommand: deleteDatasetImpl } = await import("./commands/dataset/delete.js");
    await deleteDatasetImpl(slugOrId);
  });

datasetCmd
  .command("upload <slug> <file>")
  .description("Upload a file to a dataset (creates if not found)")
  .option("--if-exists <strategy>", "Strategy when dataset exists: append (default), replace, error")
  .action(async (slug: string, file: string, options: { ifExists?: string }) => {
    const { uploadCommand: uploadDatasetImpl } = await import("./commands/dataset/upload.js");
    await uploadDatasetImpl(slug, file, options);
  });

datasetCmd
  .command("download <slugOrId>")
  .description("Download dataset records as CSV or JSONL")
  .option("-f, --format <format>", "Output format: csv or jsonl", "csv")
  .action(async (slugOrId: string, options: { format?: string }) => {
    const { downloadCommand: downloadDatasetImpl } = await import("./commands/dataset/download.js");
    await downloadDatasetImpl(slugOrId, options);
  });

datasetCmd
  .command("update <slugOrId>")
  .description("Update a dataset name or columns")
  .option("--name <name>", "New dataset name")
  .option("--columns <columns>", "New column definitions (e.g. input:string,output:string)")
  .action(async (slugOrId: string, options: { name?: string; columns?: string }) => {
    const { updateCommand: updateDatasetImpl } = await import("./commands/dataset/update.js");
    await updateDatasetImpl(slugOrId, options);
  });

// Records subcommand group
const recordsCmd = datasetCmd
  .command("records")
  .description("Manage dataset records");

recordsCmd
  .command("list <slugOrId>")
  .description("List records in a dataset")
  .option("--page <n>", "Page number (default: 1)")
  .option("--limit <n>", "Records per page (default: 20)")
  .action(async (slugOrId: string, options: { page?: string; limit?: string }) => {
    const { recordsListCommand } = await import("./commands/dataset/records-list.js");
    await recordsListCommand(slugOrId, options);
  });

recordsCmd
  .command("add <slugOrId>")
  .description("Add records to a dataset")
  .option("--json <json>", "JSON array of records (inline)")
  .option("--stdin", "Read JSON array from stdin")
  .action(async (slugOrId: string, options: { json?: string; stdin?: boolean }) => {
    const { recordsAddCommand } = await import("./commands/dataset/records-add.js");
    await recordsAddCommand(slugOrId, options);
  });

recordsCmd
  .command("update <slugOrId> <recordId>")
  .description("Update a single record in a dataset")
  .requiredOption("--json <json>", "JSON object with updated fields")
  .action(async (slugOrId: string, recordId: string, options: { json: string }) => {
    const { recordsUpdateCommand } = await import("./commands/dataset/records-update.js");
    await recordsUpdateCommand(slugOrId, recordId, options);
  });

recordsCmd
  .command("delete <slugOrId> <recordIds...>")
  .description("Delete records from a dataset")
  .action(async (slugOrId: string, recordIds: string[]) => {
    const { recordsDeleteCommand } = await import("./commands/dataset/records-delete.js");
    await recordsDeleteCommand(slugOrId, recordIds);
  });
program.parse(process.argv);