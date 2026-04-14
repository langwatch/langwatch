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

const loginCommand = async (options?: { apiKey?: string }): Promise<void> => {
  const { loginCommand: loginCommandImpl } = await import("./commands/login.js");
  return loginCommandImpl(options);
};

const listCommand = async (options?: { format?: string }): Promise<void> => {
  const { listCommand: listCommandImpl } = await import("./commands/list.js");
  return listCommandImpl(options);
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
const tagListCommand = async (options?: { format?: string }): Promise<void> => {
  const { tagListCommand: impl } = await import("./commands/tag/list.js");
  return impl(options);
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
const listEvaluatorsCommand = async (options?: { format?: string }): Promise<void> => {
  const { listEvaluatorsCommand: impl } = await import("./commands/evaluators/list.js");
  return impl(options);
};

const getEvaluatorCommand = async (idOrSlug: string, options?: { format?: string }): Promise<void> => {
  const { getEvaluatorCommand: impl } = await import("./commands/evaluators/get.js");
  return impl(idOrSlug, options);
};

const createEvaluatorCommand = async (name: string, options: { type: string }): Promise<void> => {
  const { createEvaluatorCommand: impl } = await import("./commands/evaluators/create.js");
  return impl(name, options);
};

const updateEvaluatorCommand = async (idOrSlug: string, options: { name?: string; settings?: string }): Promise<void> => {
  const { updateEvaluatorCommand: impl } = await import("./commands/evaluators/update.js");
  return impl(idOrSlug, options);
};

const deleteEvaluatorCommand = async (idOrSlug: string): Promise<void> => {
  const { deleteEvaluatorCommand: impl } = await import("./commands/evaluators/delete.js");
  return impl(idOrSlug);
};

const program = new Command();

program
  .name("langwatch")
  .description("LangWatch CLI - Manage prompts, datasets, evaluators, scenarios, suites, and more")
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
  .option("--api-key <key>", "Set API key non-interactively (for CI/CD and agents)")
  .action(async (options: { apiKey?: string }) => {
    try {
      await loginCommand(options);
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
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (options: { format?: string }) => {
    try {
      await listCommand(options);
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

promptCmd
  .command("versions <handle>")
  .description("List all versions of a prompt")
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (handle: string, options: { format?: string }) => {
    const { promptVersionsCommand: impl } = await import("./commands/prompt/versions.js");
    await impl(handle, options);
  });

promptCmd
  .command("restore <handle> <versionId>")
  .description("Restore a prompt to a previous version (creates a new version with that config)")
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (handle: string, versionId: string, options: { format?: string }) => {
    const { promptRestoreCommand: impl } = await import("./commands/prompt/restore.js");
    await impl(handle, versionId, options);
  });

// Add prompt tag subcommand group
const tagCmd = promptCmd
  .command("tag")
  .description("Manage prompt tags");

tagCmd
  .command("list")
  .description("List all tag definitions for the organization")
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (options: { format?: string }) => {
    try {
      await tagListCommand(options);
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

// Status command - project overview
program
  .command("status")
  .description("Show project resource counts and available commands")
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (options: { format?: string }) => {
    const { statusCommand: impl } = await import("./commands/status.js");
    await impl(options);
  });

// Add evaluator command group
const evaluatorCmd = program
  .command("evaluator")
  .description("Manage evaluator definitions");

evaluatorCmd
  .command("list")
  .description("List all evaluators in the project")
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (options: { format?: string }) => {
    try {
      await listEvaluatorsCommand(options);
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : "Unknown error"}`);
      process.exit(1);
    }
  });

evaluatorCmd
  .command("get <idOrSlug>")
  .description("Get evaluator details by ID or slug")
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (idOrSlug: string, options: { format?: string }) => {
    try {
      await getEvaluatorCommand(idOrSlug, options);
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
  .command("update <idOrSlug>")
  .description("Update an evaluator name or settings")
  .option("--name <name>", "New evaluator name")
  .option("--settings <json>", "Evaluator config settings as JSON")
  .action(async (idOrSlug: string, options: { name?: string; settings?: string }) => {
    try {
      await updateEvaluatorCommand(idOrSlug, options);
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

// Add evaluation command group
const evaluationCmd = program
  .command("evaluation")
  .description("Run and monitor evaluations");

evaluationCmd
  .command("run <slug>")
  .description("Start an evaluation run by slug")
  .option("--wait", "Wait for the evaluation to complete before returning")
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (slug: string, options: { wait?: boolean; format?: string }) => {
    const { runEvaluationCommand: impl } = await import("./commands/evaluation/run.js");
    await impl(slug, options);
  });

evaluationCmd
  .command("status <runId>")
  .description("Check the status of an evaluation run")
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (runId: string, options: { format?: string }) => {
    const { evaluationStatusCommand: impl } = await import("./commands/evaluation/status.js");
    await impl(runId, options);
  });

// Add workflow command group
const workflowCmd = program
  .command("workflow")
  .description("Manage workflows");

workflowCmd
  .command("list")
  .description("List all workflows in the project")
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (options: { format?: string }) => {
    const { listWorkflowsCommand: impl } = await import("./commands/workflows/list.js");
    await impl(options);
  });

workflowCmd
  .command("get <id>")
  .description("Get workflow details by ID")
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (id: string, options: { format?: string }) => {
    const { getWorkflowCommand: impl } = await import("./commands/workflows/get.js");
    await impl(id, options);
  });

workflowCmd
  .command("update <id>")
  .description("Update a workflow's metadata (name, icon, description)")
  .option("--name <name>", "New workflow name")
  .option("--icon <icon>", "New workflow icon")
  .option("--description <desc>", "New workflow description")
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (id: string, options: { name?: string; icon?: string; description?: string; format?: string }) => {
    const { updateWorkflowCommand: impl } = await import("./commands/workflows/update.js");
    await impl(id, options);
  });

workflowCmd
  .command("run <id>")
  .description("Execute a workflow with JSON input")
  .option("--input <json>", "Input data as JSON string")
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (id: string, options: { input?: string; format?: string }) => {
    const { runWorkflowCommand: impl } = await import("./commands/workflows/run.js");
    await impl(id, options);
  });

workflowCmd
  .command("delete <id>")
  .description("Archive (soft-delete) a workflow")
  .action(async (id: string) => {
    const { deleteWorkflowCommand: impl } = await import("./commands/workflows/delete.js");
    await impl(id);
  });

// Add agent command group
const agentCmd = program
  .command("agent")
  .description("Manage agent definitions");

agentCmd
  .command("list")
  .description("List all agents in the project")
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (options: { format?: string }) => {
    const { listAgentsCommand: impl } = await import("./commands/agents/list.js");
    await impl(options);
  });

agentCmd
  .command("get <id>")
  .description("Get agent details by ID")
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (id: string, options: { format?: string }) => {
    const { getAgentCommand: impl } = await import("./commands/agents/get.js");
    await impl(id, options);
  });

agentCmd
  .command("create <name>")
  .description("Create a new agent")
  .requiredOption("--type <type>", "Agent type: signature, code, workflow, or http")
  .option("--config <json>", "Agent config as JSON")
  .action(async (name: string, options: { type: string; config?: string }) => {
    const { createAgentCommand: impl } = await import("./commands/agents/create.js");
    await impl(name, options);
  });

agentCmd
  .command("run <id>")
  .description("Execute an agent with JSON input (HTTP agents call URL directly, others use workflow engine)")
  .option("--input <json>", "Input data as JSON string")
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (id: string, options: { input?: string; format?: string }) => {
    const { runAgentCommand: impl } = await import("./commands/agents/run.js");
    await impl(id, options);
  });

agentCmd
  .command("update <id>")
  .description("Update an agent name, type, or configuration")
  .option("--name <name>", "New agent name")
  .option("--type <type>", "New agent type: signature, code, workflow, or http")
  .option("--config <json>", "Updated configuration as JSON")
  .action(async (id: string, options: { name?: string; type?: string; config?: string }) => {
    const { updateAgentCommand: impl } = await import("./commands/agents/update.js");
    await impl(id, options);
  });

agentCmd
  .command("delete <id>")
  .description("Archive (soft-delete) an agent")
  .action(async (id: string) => {
    const { deleteAgentCommand: impl } = await import("./commands/agents/delete.js");
    await impl(id);
  });

// Add dashboard command group
const dashboardCmd = program
  .command("dashboard")
  .description("Manage analytics dashboards");

dashboardCmd
  .command("list")
  .description("List all dashboards in the project")
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (options: { format?: string }) => {
    const { listDashboardsCommand: impl } = await import("./commands/dashboards/list.js");
    await impl(options);
  });

dashboardCmd
  .command("get <id>")
  .description("Get dashboard details by ID")
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (id: string, options: { format?: string }) => {
    const { getDashboardCommand: impl } = await import("./commands/dashboards/get.js");
    await impl(id, options);
  });

dashboardCmd
  .command("update <id>")
  .description("Rename a dashboard")
  .requiredOption("--name <name>", "New dashboard name")
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (id: string, options: { name?: string; format?: string }) => {
    const { updateDashboardCommand: impl } = await import("./commands/dashboards/update.js");
    await impl(id, options);
  });

dashboardCmd
  .command("create <name>")
  .description("Create a new dashboard")
  .action(async (name: string) => {
    const { createDashboardCommand: impl } = await import("./commands/dashboards/create.js");
    await impl(name);
  });

dashboardCmd
  .command("delete <id>")
  .description("Delete a dashboard and its graphs")
  .action(async (id: string) => {
    const { deleteDashboardCommand: impl } = await import("./commands/dashboards/delete.js");
    await impl(id);
  });

// Add model-provider command group
const modelProviderCmd = program
  .command("model-provider")
  .description("Manage LLM model provider configurations");

modelProviderCmd
  .command("list")
  .description("List all configured model providers")
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (options: { format?: string }) => {
    const { listModelProvidersCommand: impl } = await import("./commands/model-providers/list.js");
    await impl(options);
  });

modelProviderCmd
  .command("set <provider>")
  .description("Configure a model provider (e.g. openai, anthropic)")
  .option("--enabled <boolean>", "Enable or disable the provider", (v) => v === "true")
  .option("--api-key <key>", "API key for the provider")
  .option("--default-model <model>", "Default model to use (e.g. gpt-4o)")
  .action(async (provider: string, options: { enabled?: boolean; apiKey?: string; defaultModel?: string }) => {
    const { setModelProviderCommand: impl } = await import("./commands/model-providers/set.js");
    await impl(provider, options);
  });

// Add annotation command group
const annotationCmd = program
  .command("annotation")
  .description("Manage trace annotations");

annotationCmd
  .command("list")
  .description("List all annotations (optionally filtered by trace)")
  .option("--trace-id <traceId>", "Filter by trace ID")
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (options: { traceId?: string; format?: string }) => {
    const { listAnnotationsCommand: impl } = await import("./commands/annotations/list.js");
    await impl(options);
  });

annotationCmd
  .command("get <id>")
  .description("Get annotation details by ID")
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (id: string, options: { format?: string }) => {
    const { getAnnotationCommand: impl } = await import("./commands/annotations/get.js");
    await impl(id, options);
  });

annotationCmd
  .command("create <traceId>")
  .description("Create an annotation for a trace")
  .option("--comment <comment>", "Annotation comment")
  .option("--thumbs-up", "Mark as thumbs up")
  .option("--thumbs-down", "Mark as thumbs down")
  .option("--email <email>", "Email of the annotator")
  .action(async (traceId: string, options: { comment?: string; thumbsUp?: boolean; thumbsDown?: boolean; email?: string }) => {
    const { createAnnotationCommand: impl } = await import("./commands/annotations/create.js");
    await impl(traceId, options);
  });

annotationCmd
  .command("delete <id>")
  .description("Delete an annotation")
  .action(async (id: string) => {
    const { deleteAnnotationCommand: impl } = await import("./commands/annotations/delete.js");
    await impl(id);
  });

// Add analytics command group
const analyticsCmd = program
  .command("analytics")
  .description("Query analytics and metrics");

analyticsCmd
  .command("query")
  .description("Query timeseries analytics (costs, latency, token usage, etc.)")
  .option("-m, --metric <metric>", "Metric to query (preset name or raw metric path, default: trace-count)")
  .option("-a, --aggregation <aggregation>", "Aggregation type: cardinality, avg, sum, min, max, p95, p99")
  .option("--start-date <date>", "Start date (ISO string, default: 7 days ago)")
  .option("--end-date <date>", "End date (ISO string, default: now)")
  .option("--group-by <field>", "Group by field (e.g. metadata.model)")
  .option("--time-scale <scale>", "Time scale: 'full' for aggregate, or interval in seconds")
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (options: { metric?: string; aggregation?: string; startDate?: string; endDate?: string; groupBy?: string; timeScale?: string; format?: string }) => {
    const { queryAnalyticsCommand: impl } = await import("./commands/analytics/query.js");
    await impl(options);
  });

// Add trace command group
const traceCmd = program
  .command("trace")
  .description("Search and inspect traces");

traceCmd
  .command("search")
  .description("Search traces with optional text query and date range")
  .option("-q, --query <query>", "Text search query")
  .option("--start-date <date>", "Start date (ISO string or epoch ms, default: 24h ago)")
  .option("--end-date <date>", "End date (ISO string or epoch ms, default: now)")
  .option("--limit <n>", "Max results to return (default: 25)")
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (options: { query?: string; startDate?: string; endDate?: string; limit?: string; format?: string }) => {
    const { searchTracesCommand: impl } = await import("./commands/traces/search.js");
    await impl(options);
  });

traceCmd
  .command("export")
  .description("Export traces as CSV, JSONL, or JSON")
  .option("--start-date <date>", "Start date (ISO string, default: 7 days ago)")
  .option("--end-date <date>", "End date (ISO string, default: now)")
  .option("-q, --query <query>", "Text search query to filter traces")
  .option("-f, --format <format>", "Output format: jsonl (default), csv, or json", "jsonl")
  .option("-o, --output <file>", "Write output to file instead of stdout")
  .option("--limit <n>", "Max traces to export (default: 1000)")
  .action(async (options: { startDate?: string; endDate?: string; query?: string; format?: string; output?: string; limit?: string }) => {
    const { exportTracesCommand: impl } = await import("./commands/traces/export.js");
    await impl(options);
  });

traceCmd
  .command("get <traceId>")
  .description("Get full trace details by ID")
  .option("-f, --format <format>", "Output format: digest (default, human-readable) or json", "digest")
  .action(async (traceId: string, options: { format?: string }) => {
    const { getTraceCommand: impl } = await import("./commands/traces/get.js");
    await impl(traceId, options);
  });

// Add scenario command group
const scenarioCmd = program
  .command("scenario")
  .description("Manage scenarios");

scenarioCmd
  .command("list")
  .description("List all scenarios in the project")
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (options: { format?: string }) => {
    const { listScenariosCommand: impl } = await import("./commands/scenarios/list.js");
    await impl(options);
  });

scenarioCmd
  .command("get <id>")
  .description("Get scenario details by ID")
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (id: string, options: { format?: string }) => {
    const { getScenarioCommand: impl } = await import("./commands/scenarios/get.js");
    await impl(id, options);
  });

scenarioCmd
  .command("create <name>")
  .description("Create a new scenario")
  .requiredOption("--situation <situation>", "The situation/context for the scenario")
  .option("--criteria <criteria>", "Comma-separated list of evaluation criteria")
  .option("--labels <labels>", "Comma-separated list of labels")
  .action(async (name: string, options: { situation: string; criteria?: string; labels?: string }) => {
    const { createScenarioCommand: impl } = await import("./commands/scenarios/create.js");
    await impl(name, options);
  });

scenarioCmd
  .command("update <id>")
  .description("Update an existing scenario")
  .option("--name <name>", "New scenario name")
  .option("--situation <situation>", "New situation/context")
  .option("--criteria <criteria>", "New comma-separated list of criteria (replaces existing)")
  .option("--labels <labels>", "New comma-separated list of labels (replaces existing)")
  .action(async (id: string, options: { name?: string; situation?: string; criteria?: string; labels?: string }) => {
    const { updateScenarioCommand: impl } = await import("./commands/scenarios/update.js");
    await impl(id, options);
  });

scenarioCmd
  .command("run <id>")
  .description("Run a scenario against a target (agent or prompt)")
  .requiredOption("--target <target>", "Target to run against, as <type>:<referenceId> (e.g., http:agent_abc123)")
  .option("--wait", "Wait for the scenario run to complete")
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (id: string, options: { target: string; wait?: boolean; format?: string }) => {
    const { runScenarioCommand: impl } = await import("./commands/scenarios/run.js");
    await impl(id, options);
  });

scenarioCmd
  .command("delete <id>")
  .description("Archive (soft-delete) a scenario")
  .action(async (id: string) => {
    const { deleteScenarioCommand: impl } = await import("./commands/scenarios/delete.js");
    await impl(id);
  });

// Add suite (run plan) command group
const suiteCmd = program
  .command("suite")
  .description("Manage suites (run plans) — scenario × target execution plans");

suiteCmd
  .command("list")
  .description("List all suites in the project")
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (options: { format?: string }) => {
    const { listSuitesCommand: impl } = await import("./commands/suites/list.js");
    await impl(options);
  });

suiteCmd
  .command("get <id>")
  .description("Get suite details by ID")
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (id: string, options: { format?: string }) => {
    const { getSuiteCommand: impl } = await import("./commands/suites/get.js");
    await impl(id, options);
  });

suiteCmd
  .command("create <name>")
  .description("Create a new suite (run plan)")
  .requiredOption("--scenarios <ids>", "Comma-separated scenario IDs")
  .requiredOption("--targets <targets...>", "Targets as <type>:<referenceId> (e.g., http:agent_abc)")
  .option("--repeat-count <n>", "Number of times to repeat each scenario-target pair", "1")
  .option("--labels <labels>", "Comma-separated labels")
  .option("--description <desc>", "Suite description")
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (name: string, options: { scenarios?: string; targets?: string[]; repeatCount?: string; labels?: string; description?: string; format?: string }) => {
    const { createSuiteCommand: impl } = await import("./commands/suites/create.js");
    await impl(name, options);
  });

suiteCmd
  .command("update <id>")
  .description("Update a suite (run plan)")
  .option("--name <name>", "New suite name")
  .option("--scenarios <ids>", "New comma-separated scenario IDs")
  .option("--targets <targets...>", "New targets as <type>:<referenceId>")
  .option("--repeat-count <n>", "New repeat count")
  .option("--labels <labels>", "New comma-separated labels")
  .option("--description <desc>", "New description")
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (id: string, options: { name?: string; scenarios?: string; targets?: string[]; repeatCount?: string; labels?: string; description?: string; format?: string }) => {
    const { updateSuiteCommand: impl } = await import("./commands/suites/update.js");
    await impl(id, options);
  });

suiteCmd
  .command("duplicate <id>")
  .description("Duplicate a suite")
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (id: string, options: { format?: string }) => {
    const { duplicateSuiteCommand: impl } = await import("./commands/suites/duplicate.js");
    await impl(id, options);
  });

suiteCmd
  .command("run <id>")
  .description("Execute a suite run — schedules all scenario × target × repeat jobs")
  .option("--wait", "Wait for the suite run to complete before returning")
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (id: string, options: { wait?: boolean; format?: string }) => {
    const { runSuiteCommand: impl } = await import("./commands/suites/run.js");
    await impl(id, options);
  });

suiteCmd
  .command("delete <id>")
  .description("Archive (soft-delete) a suite")
  .action(async (id: string) => {
    const { deleteSuiteCommand: impl } = await import("./commands/suites/delete.js");
    await impl(id);
  });

// Add graph command group
const graphCmd = program
  .command("graph")
  .description("Manage custom graphs on dashboards");

graphCmd
  .command("list")
  .description("List all custom graphs (optionally filter by dashboard)")
  .option("--dashboard-id <id>", "Filter by dashboard ID")
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (options: { dashboardId?: string; format?: string }) => {
    const { listGraphsCommand: impl } = await import("./commands/graphs/list.js");
    await impl(options);
  });

graphCmd
  .command("create <name>")
  .description("Create a custom graph")
  .option("--dashboard-id <id>", "Dashboard to add the graph to")
  .option("--graph <json>", "Graph definition as JSON")
  .option("--filters <json>", "Filter conditions as JSON")
  .option("--col-span <n>", "Column span (1-2)")
  .option("--row-span <n>", "Row span (1-2)")
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (name: string, options: { dashboardId?: string; graph?: string; filters?: string; colSpan?: string; rowSpan?: string; format?: string }) => {
    const { createGraphCommand: impl } = await import("./commands/graphs/create.js");
    await impl(name, options);
  });

graphCmd
  .command("update <id>")
  .description("Update a custom graph")
  .option("--name <name>", "New graph name")
  .option("--graph <json>", "New graph definition as JSON")
  .option("--filters <json>", "New filter conditions as JSON")
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (id: string, options: { name?: string; graph?: string; filters?: string; format?: string }) => {
    const { updateGraphCommand: impl } = await import("./commands/graphs/update.js");
    await impl(id, options);
  });

graphCmd
  .command("delete <id>")
  .description("Delete a custom graph")
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (id: string, options: { format?: string }) => {
    const { deleteGraphCommand: impl } = await import("./commands/graphs/delete.js");
    await impl(id, options);
  });

// Add trigger (automation) command group
const triggerCmd = program
  .command("trigger")
  .description("Manage triggers (automations) — alerts, webhooks, and dataset actions");

triggerCmd
  .command("list")
  .description("List all triggers in the project")
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (options: { format?: string }) => {
    const { listTriggersCommand: impl } = await import("./commands/triggers/list.js");
    await impl(options);
  });

triggerCmd
  .command("get <id>")
  .description("Get trigger details by ID")
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (id: string, options: { format?: string }) => {
    const { getTriggerCommand: impl } = await import("./commands/triggers/get.js");
    await impl(id, options);
  });

triggerCmd
  .command("create <name>")
  .description("Create a new trigger (automation)")
  .requiredOption("--action <action>", "Trigger action: SEND_EMAIL, ADD_TO_DATASET, ADD_TO_ANNOTATION_QUEUE, SEND_SLACK_MESSAGE")
  .option("--filters <json>", "Trigger filter conditions as JSON")
  .option("--message <text>", "Custom alert message")
  .option("--alert-type <type>", "Alert severity: CRITICAL, WARNING, INFO")
  .option("--slack-webhook <url>", "Slack webhook URL (for SEND_SLACK_MESSAGE action)")
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (name: string, options: { action: string; filters?: string; message?: string; alertType?: string; slackWebhook?: string; format?: string }) => {
    const { createTriggerCommand: impl } = await import("./commands/triggers/create.js");
    await impl(name, options);
  });

triggerCmd
  .command("update <id>")
  .description("Update a trigger")
  .option("--name <name>", "New trigger name")
  .option("--active <boolean>", "Enable or disable the trigger (true/false)")
  .option("--message <text>", "New alert message")
  .option("--alert-type <type>", "New alert severity")
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (id: string, options: { name?: string; active?: string; message?: string; alertType?: string; format?: string }) => {
    const { updateTriggerCommand: impl } = await import("./commands/triggers/update.js");
    await impl(id, options);
  });

triggerCmd
  .command("delete <id>")
  .description("Delete a trigger")
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (id: string, options: { format?: string }) => {
    const { deleteTriggerCommand: impl } = await import("./commands/triggers/delete.js");
    await impl(id, options);
  });

// Add secret command group
const secretCmd = program
  .command("secret")
  .description("Manage project secrets — encrypted environment variables for agents");

secretCmd
  .command("list")
  .description("List all secrets in the project (values are never shown)")
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (options: { format?: string }) => {
    const { listSecretsCommand: impl } = await import("./commands/secrets/list.js");
    await impl(options);
  });

secretCmd
  .command("get <id>")
  .description("Get secret metadata by ID (value is never shown)")
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (id: string, options: { format?: string }) => {
    const { getSecretCommand: impl } = await import("./commands/secrets/get.js");
    await impl(id, options);
  });

secretCmd
  .command("create <name>")
  .description("Create a new secret (name must be UPPER_SNAKE_CASE)")
  .requiredOption("--value <value>", "The secret value (will be encrypted)")
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (name: string, options: { value: string; format?: string }) => {
    const { createSecretCommand: impl } = await import("./commands/secrets/create.js");
    await impl(name, options);
  });

secretCmd
  .command("update <id>")
  .description("Update a secret's value")
  .requiredOption("--value <value>", "The new secret value (will be encrypted)")
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (id: string, options: { value: string; format?: string }) => {
    const { updateSecretCommand: impl } = await import("./commands/secrets/update.js");
    await impl(id, options);
  });

secretCmd
  .command("delete <id>")
  .description("Delete a secret")
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (id: string, options: { format?: string }) => {
    const { deleteSecretCommand: impl } = await import("./commands/secrets/delete.js");
    await impl(id, options);
  });

// Add monitor (online evaluation) command group
const monitorCmd = program
  .command("monitor")
  .description("Manage online evaluation monitors — evaluators running on incoming traces");

monitorCmd
  .command("list")
  .description("List all monitors in the project")
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (options: { format?: string }) => {
    const { listMonitorsCommand: impl } = await import("./commands/monitors/list.js");
    await impl(options);
  });

monitorCmd
  .command("get <id>")
  .description("Get monitor details by ID")
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (id: string, options: { format?: string }) => {
    const { getMonitorCommand: impl } = await import("./commands/monitors/get.js");
    await impl(id, options);
  });

monitorCmd
  .command("create <name>")
  .description("Create a new online evaluation monitor")
  .requiredOption("--check-type <type>", "Evaluator check type (e.g. ragas/toxicity, custom/my-eval)")
  .option("--execution-mode <mode>", "Execution mode: ON_MESSAGE (default), AS_GUARDRAIL, MANUALLY", "ON_MESSAGE")
  .option("--sample <rate>", "Sampling rate 0.0-1.0 (default: 1.0)")
  .option("--evaluator-id <id>", "Link to a saved evaluator")
  .option("--level <level>", "Evaluation level: trace (default) or thread")
  .option("--parameters <json>", "Evaluator settings as JSON")
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (name: string, options: { checkType: string; executionMode?: string; sample?: string; evaluatorId?: string; level?: string; parameters?: string; format?: string }) => {
    const { createMonitorCommand: impl } = await import("./commands/monitors/create.js");
    await impl(name, options);
  });

monitorCmd
  .command("update <id>")
  .description("Update a monitor")
  .option("--name <name>", "New monitor name")
  .option("--enabled <boolean>", "Enable or disable the monitor (true/false)")
  .option("--execution-mode <mode>", "Execution mode: ON_MESSAGE, AS_GUARDRAIL, MANUALLY")
  .option("--sample <rate>", "Sampling rate 0.0-1.0")
  .option("--parameters <json>", "Updated evaluator settings as JSON")
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (id: string, options: { name?: string; enabled?: string; executionMode?: string; sample?: string; parameters?: string; format?: string }) => {
    const { updateMonitorCommand: impl } = await import("./commands/monitors/update.js");
    await impl(id, options);
  });

monitorCmd
  .command("delete <id>")
  .description("Delete a monitor")
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (id: string, options: { format?: string }) => {
    const { deleteMonitorCommand: impl } = await import("./commands/monitors/delete.js");
    await impl(id, options);
  });

// Add simulation-run command group
const simulationRunCmd = program
  .command("simulation-run")
  .description("View simulation run results");

simulationRunCmd
  .command("list")
  .description("List simulation runs (optionally filter by scenario set or batch)")
  .option("--scenario-set-id <id>", "Filter by scenario set ID")
  .option("--batch-run-id <id>", "Filter by batch run ID (requires --scenario-set-id)")
  .option("--limit <n>", "Max results (default: 20)")
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (options: { scenarioSetId?: string; batchRunId?: string; limit?: string; format?: string }) => {
    const { listSimulationRunsCommand: impl } = await import("./commands/simulation-runs/list.js");
    await impl(options);
  });

simulationRunCmd
  .command("get <runId>")
  .description("Get full details of a simulation run (messages, results, costs)")
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (runId: string, options: { format?: string }) => {
    const { getSimulationRunCommand: impl } = await import("./commands/simulation-runs/get.js");
    await impl(runId, options);
  });

// Add dataset command group
const datasetCmd = program
  .command("dataset")
  .description("Manage datasets");

datasetCmd
  .command("list")
  .description("List all datasets")
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (options: { format?: string }) => {
    const { listCommand: listDatasetsImpl } = await import("./commands/dataset/list.js");
    await listDatasetsImpl(options);
  });

datasetCmd
  .command("create <name>")
  .description("Create a new dataset")
  .option("-c, --columns <columns>", "Column definitions (e.g. input:string,output:string)")
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (name: string, options: { columns?: string; format?: string }) => {
    const { createCommand: createDatasetImpl } = await import("./commands/dataset/create.js");
    await createDatasetImpl(name, options);
  });

datasetCmd
  .command("get <slugOrId>")
  .description("Get dataset details and preview records")
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (slugOrId: string, options: { format?: string }) => {
    const { getCommand: getDatasetImpl } = await import("./commands/dataset/get.js");
    await getDatasetImpl(slugOrId, options);
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
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (slugOrId: string, options: { page?: string; limit?: string; format?: string }) => {
    const { recordsListCommand } = await import("./commands/dataset/records-list.js");
    await recordsListCommand(slugOrId, options);
  });

recordsCmd
  .command("add <slugOrId>")
  .description("Add records to a dataset")
  .option("--json <json>", "JSON array of records (inline)")
  .option("--file <path>", "Read JSON array of records from a file")
  .option("--stdin", "Read JSON array from stdin")
  .action(async (slugOrId: string, options: { json?: string; file?: string; stdin?: boolean }) => {
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