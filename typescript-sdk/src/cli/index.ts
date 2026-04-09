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
  .description("LangWatch CLI - The npm of prompts")
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

program.parse(process.argv);