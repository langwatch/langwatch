#!/usr/bin/env node

// Load environment variables BEFORE any other imports
import { config } from "dotenv";
config();

import { Command } from "commander";
import { parsePromptSpec } from "./types";
import { formatApiErrorMessage } from "../client-sdk/services/_shared/format-api-error";
import { experimentListRunsCommand } from "./commands/experiment/list-runs.js";
import { experimentResultsCommand } from "./commands/experiment/results.js";
import { experimentListCommand } from "./commands/experiment/list.js";

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

const loginCommand = async (
  options?: { apiKey?: string; device?: boolean; browser?: string },
): Promise<void> => {
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

const createEvaluatorCommand = async (name: string, options: { type: string; format?: string }): Promise<void> => {
  const { createEvaluatorCommand: impl } = await import("./commands/evaluators/create.js");
  return impl(name, options);
};

const updateEvaluatorCommand = async (idOrSlug: string, options: { name?: string; settings?: string; format?: string }): Promise<void> => {
  const { updateEvaluatorCommand: impl } = await import("./commands/evaluators/update.js");
  return impl(idOrSlug, options);
};

const deleteEvaluatorCommand = async (idOrSlug: string, options?: { format?: string }): Promise<void> => {
  const { deleteEvaluatorCommand: impl } = await import("./commands/evaluators/delete.js");
  return impl(idOrSlug, options);
};

const program = new Command();

program
  .name("langwatch")
  .description("LangWatch CLI - Manage prompts, datasets, evaluators, scenarios, suites, and more")
  .version(__CLI_VERSION__, "-v, --version", "Display the current version")
  .enablePositionalOptions()
  .passThroughOptions()
  .configureHelp({
    showGlobalOptions: true,
  })
  .showHelpAfterError()
  .showSuggestionAfterError();

// Top-level commands
const loginCmd = program
  .command("login")
  .description(
    "Login to LangWatch. With no flags, asks where (cloud vs self-hosted) and how (AI tools vs project SDK). For CI/agents pass --device, --api-key, or --token to skip prompts.",
  )
  .option("--api-key <key>", "Set API key non-interactively (CI/agents that already have a project API key) — writes to .env")
  .option("--endpoint <url>", "Override the LangWatch control-plane URL for this login (self-hosted instances)")
  .option(
    "--device",
    "RFC 8628 device-flow login via your company SSO; provisions a personal virtual key for Claude Code / Codex / Cursor / Gemini CLI",
  )
  .option(
    "--token <token>",
    "Set device-session token non-interactively (CI/agents that already have a pre-minted token from the dashboard) — writes to ~/.langwatch/config.json",
  )
  .option(
    "--browser <name>",
    "browser to open for device-flow approval (chrome|chromium|firefox|safari|none|<path>)",
  );

loginCmd.action(async (options: { apiKey?: string; device?: boolean; browser?: string; endpoint?: string; token?: string }) => {
  try {
    await loginCommand(options);
  } catch (error) {
    console.error(`Error: ${formatApiErrorMessage({ error })}`);
    process.exit(1);
  }
});

// `langwatch config <get|set|list>` — explicit persistence + introspection
// for user-global CLI config. Mirrors `gh config` / `doctl auth init` /
// `stripe config` patterns so users don't hand-edit ~/.langwatch/config.json.
const configCmd = program
  .command("config")
  .description("Read or write user-global CLI configuration (endpoint, gateway-url)");

configCmd
  .command("set <key> <value>")
  .description("Persist a config value to ~/.langwatch/config.json (e.g. `langwatch config set endpoint https://lw.acme.internal`)")
  .action(async (key: string, value: string) => {
    const { configSetCommand } = await import("./commands/config.js");
    await configSetCommand(key, value);
  });

configCmd
  .command("get <key>")
  .description("Print the resolved value for a config key (uses the same flag > env > config > default priority as the CLI)")
  .action(async (key: string) => {
    const { configGetCommand } = await import("./commands/config.js");
    await configGetCommand(key);
  });

configCmd
  .command("list")
  .description("List the current resolved values + their sources (no secrets shown)")
  .action(async () => {
    const { configListCommand } = await import("./commands/config.js");
    await configListCommand();
  });

program
  .command("open [path]")
  .description(
    "Open the LangWatch app in your browser. No path: /me in personal mode, project home if LANGWATCH_API_KEY is set. With a path: BASE/<path>.",
  )
  .option("--browser <name>", "browser to open (chrome|chromium|firefox|safari|none|<path>)")
  .action(async (path: string | undefined, options: { browser?: string }) => {
    try {
      const { openCommand } = await import("./commands/open.js");
      await openCommand({ path, browser: options.browser });
    } catch (error) {
      console.error(`Error: ${formatApiErrorMessage({ error })}`);
      process.exit(1);
    }
  });

// AI Gateway governance — read identity, deep-link, request budget increase.
program
  .command("whoami")
  .description("Print the identity persisted by `langwatch login --device` (governance plane).")
  .action(async () => {
    try {
      const { whoamiCommand } = await import("./commands/whoami.js");
      await whoamiCommand();
    } catch (error) {
      console.error(`Error: ${formatApiErrorMessage({ error })}`);
      process.exit(1);
    }
  });

program
  .command("request-increase")
  .description("Open the budget-increase request page (uses the gateway-issued signed URL when available).")
  .option("--browser <name>", "browser to open (chrome|chromium|firefox|safari|none|<path>)")
  .action(async (options: { browser?: string }) => {
    try {
      const { requestIncreaseCommand } = await import("./commands/request-increase.js");
      await requestIncreaseCommand(options);
    } catch (error) {
      console.error(`Error: ${formatApiErrorMessage({ error })}`);
      process.exit(1);
    }
  });

// AI Gateway governance — wrapped tool runners.
// Each `langwatch <tool>` exec's the underlying binary with the
// right ANTHROPIC_*/OPENAI_*/GEMINI_* env vars injected pointing
// at the gateway, after a Screen-8 budget pre-check.
//
// Marked `hidden:true` so they don't pollute the top-level command list
// in `langwatch --help`; rendered together under a "Coding assistants:"
// section via addHelpText below. `langwatch <tool> --help` still works.
program
  .command("claude", { hidden: true })
  .description("Run `claude` (Claude Code) routed through the LangWatch gateway.")
  .allowUnknownOption(true)
  .helpOption(false)
  .action(async (_opts, cmd: { args?: string[] }) => {
    try {
      const { wrapClaude } = await import("./commands/wrap.js");
      await wrapClaude(cmd.args ?? []);
    } catch (error) {
      console.error(`Error: ${formatApiErrorMessage({ error })}`);
      process.exit(1);
    }
  });

program
  .command("codex", { hidden: true })
  .description("Run `codex` (OpenAI Codex CLI) routed through the LangWatch gateway.")
  .allowUnknownOption(true)
  .helpOption(false)
  .action(async (_opts, cmd: { args?: string[] }) => {
    try {
      const { wrapCodex } = await import("./commands/wrap.js");
      await wrapCodex(cmd.args ?? []);
    } catch (error) {
      console.error(`Error: ${formatApiErrorMessage({ error })}`);
      process.exit(1);
    }
  });

program
  .command("cursor", { hidden: true })
  .description("Run `cursor` routed through the LangWatch gateway.")
  .allowUnknownOption(true)
  .helpOption(false)
  .action(async (_opts, cmd: { args?: string[] }) => {
    try {
      const { wrapCursor } = await import("./commands/wrap.js");
      await wrapCursor(cmd.args ?? []);
    } catch (error) {
      console.error(`Error: ${formatApiErrorMessage({ error })}`);
      process.exit(1);
    }
  });

program
  .command("gemini", { hidden: true })
  .description("Run `gemini` (Gemini CLI) routed through the LangWatch gateway.")
  .allowUnknownOption(true)
  .helpOption(false)
  .action(async (_opts, cmd: { args?: string[] }) => {
    try {
      const { wrapGemini } = await import("./commands/wrap.js");
      await wrapGemini(cmd.args ?? []);
    } catch (error) {
      console.error(`Error: ${formatApiErrorMessage({ error })}`);
      process.exit(1);
    }
  });

program
  .command("opencode", { hidden: true })
  .description("Run `opencode` routed through the LangWatch gateway (multi-provider; injects both Anthropic and OpenAI env vars).")
  .allowUnknownOption(true)
  .helpOption(false)
  .action(async (_opts, cmd: { args?: string[] }) => {
    try {
      const { wrapOpencode } = await import("./commands/wrap.js");
      await wrapOpencode(cmd.args ?? []);
    } catch (error) {
      console.error(`Error: ${formatApiErrorMessage({ error })}`);
      process.exit(1);
    }
  });

// 'after' (not 'afterAll') so the section only renders on `langwatch --help`,
// not on every `langwatch <subcommand> --help` invocation.
program.addHelpText(
  "after",
  [
    "",
    "Coding assistants:",
    "  claude          Run `claude` (Claude Code) routed through the gateway",
    "  codex           Run `codex` (OpenAI Codex CLI) routed through the gateway",
    "  cursor          Run `cursor` routed through the gateway",
    "  gemini          Run `gemini` (Gemini CLI) routed through the gateway",
    "  opencode        Run `opencode` (multi-provider) routed through the gateway",
    "",
  ].join("\n"),
);

program
  .command("logout-device")
  .description("Server-revoke the device-flow refresh token AND clear the local ~/.langwatch/config.json. Idempotent.")
  .action(async () => {
    try {
      const { logoutDeviceCommand } = await import("./commands/logout-device.js");
      await logoutDeviceCommand();
    } catch (error) {
      console.error(`Error: ${formatApiErrorMessage({ error })}`);
      process.exit(1);
    }
  });

program
  .command("init-shell")
  .description("Print an eval-able shell snippet so any shell session auto-exports the gateway env vars (alternative to `langwatch claude`).")
  .argument("[shell]", "zsh|bash|fish|cmd|powershell", "zsh")
  .action(async (shell: string) => {
    try {
      const { initShellCommand } = await import("./commands/init-shell.js");
      await initShellCommand(shell);
    } catch (error) {
      console.error(`Error: ${formatApiErrorMessage({ error })}`);
      process.exit(1);
    }
  });

// `langwatch ingest *` — read-only debug tools for the IngestionSource
// + Activity Monitor surfaces. Mirrors the web admin /settings/governance
// flows for ops folks who live in terminal. Authoring stays browser-only.
const ingestCmd = program
  .command("ingest")
  .description("Inspect IngestionSources and tail their recent OCSF-normalised events (read-only governance debug helpers).");

ingestCmd
  .command("list")
  .description("List the org's IngestionSources (active by default; --all includes archived).")
  .option("--all", "include archived sources")
  .option("--json", "emit machine-readable JSON")
  .action(async (options: { all?: boolean; json?: boolean }) => {
    try {
      const { ingestListCommand } = await import("./commands/ingest/list.js");
      await ingestListCommand(options);
    } catch (error) {
      console.error(`Error: ${formatApiErrorMessage({ error })}`);
      process.exit(1);
    }
  });

ingestCmd
  .command("tail <sourceId>")
  .description("Stream the most recent events for an IngestionSource. --follow polls every 3s.")
  .option("--limit <n>", "how many events to fetch on first poll (default 50)", (v) => parseInt(v, 10))
  .option("--follow", "keep polling for new events; exit on Ctrl-C")
  .option("--json", "emit machine-readable JSON")
  .action(async (sourceId: string, options: { limit?: number; follow?: boolean; json?: boolean }) => {
    try {
      const { ingestTailCommand } = await import("./commands/ingest/tail.js");
      await ingestTailCommand(sourceId, options);
    } catch (error) {
      console.error(`Error: ${formatApiErrorMessage({ error })}`);
      process.exit(1);
    }
  });

ingestCmd
  .command("health <sourceId>")
  .description("Show events received in the last 24h / 7d / 30d + last-success timestamp for one IngestionSource.")
  .option("--json", "emit machine-readable JSON")
  .action(async (sourceId: string, options: { json?: boolean }) => {
    try {
      const { ingestHealthCommand } = await import("./commands/ingest/health.js");
      await ingestHealthCommand(sourceId, options);
    } catch (error) {
      console.error(`Error: ${formatApiErrorMessage({ error })}`);
      process.exit(1);
    }
  });

ingestCmd
  .command("install <tool>")
  .description(
    "Path B activation for a wrapped tool. Mints or rotates the user's ingestion binding, prints the OTLP export block, and (for codex) idempotently merges the [otel] block into ~/.codex/config.toml.",
  )
  .option("--env-only", "skip the codex config.toml write; print exports only")
  .option("--json", "emit machine-readable JSON")
  .action(
    async (
      tool: string,
      options: { envOnly?: boolean; json?: boolean },
    ) => {
      const { installCommand } = await import(
        "./commands/ingestion/install.js"
      );
      await installCommand(tool, options);
    },
  );

const governanceCmd = program
  .command("governance")
  .description(
    "Manage governance resources (ingestion templates, user ingestion bindings) from the CLI. Mirrors the public REST surface at /api/governance/* — every mutating call lands an audit row with metadata.surface='cli'.",
  );

governanceCmd
  .command("status")
  .description("Show the org's governance setup-state OR-of-flags (mirrors api.governance.setupState).")
  .option("--json", "emit machine-readable JSON")
  .action(async (options: { json?: boolean }) => {
    try {
      const { governanceStatusCommand } = await import("./commands/governance/status.js");
      await governanceStatusCommand(options);
    } catch (error) {
      console.error(`Error: ${formatApiErrorMessage({ error })}`);
      process.exit(1);
    }
  });

// ── Ingestion templates (admin/platform-curated catalog) ──────────────────

const templatesCmd = governanceCmd
  .command("ingestion-templates")
  .description("CRUD on IngestionTemplate rows. Reads use aiTools:view; mutations use aiTools:manage.");

templatesCmd
  .command("list")
  .description("List enabled ingestion templates visible to the caller's org (platform + org-authored).")
  .option("--json", "emit machine-readable JSON")
  .action(async (options: { json?: boolean }) => {
    const { listCommand } = await import(
      "./commands/governance/ingestion-templates.js"
    );
    await listCommand(options);
  });

templatesCmd
  .command("admin-list")
  .description("Admin readonly catalog — includes ottl_rules. Requires aiTools:manage.")
  .option("--json", "emit machine-readable JSON")
  .action(async (options: { json?: boolean }) => {
    const { adminListCommand } = await import(
      "./commands/governance/ingestion-templates.js"
    );
    await adminListCommand(options);
  });

templatesCmd
  .command("get <id>")
  .description("Fetch a single ingestion template by id.")
  .option("--json", "emit machine-readable JSON")
  .action(async (id: string, options: { json?: boolean }) => {
    const { getCommand } = await import(
      "./commands/governance/ingestion-templates.js"
    );
    await getCommand(id, options);
  });

templatesCmd
  .command("create")
  .description("Author a new org-authored ingestion template.")
  .requiredOption("--source-type <slug>", "lowercase letters/digits/underscores, max 40 chars")
  .requiredOption("--display-name <name>", "human-readable label")
  .option("--description <text>", "optional description")
  .option("--icon-asset <asset>", "preset:<kind> | data:image/svg+xml;base64,...")
  .option(
    "--credential-schema <kind>",
    "otlp_token | static_api_key | agent_id (defaults to otlp_token)",
  )
  .option("--ottl-rules <text>", "OTTL rules (newline-separated statements)")
  .option("--json", "emit machine-readable JSON")
  .action(
    async (options: {
      sourceType: string;
      displayName: string;
      description?: string;
      iconAsset?: string;
      credentialSchema?: string;
      ottlRules?: string;
      json?: boolean;
    }) => {
      const { createCommand } = await import(
        "./commands/governance/ingestion-templates.js"
      );
      await createCommand(options);
    },
  );

templatesCmd
  .command("update-ottl-rules <id>")
  .description("Replace ottl_rules on an org-authored template. Platform rows reject.")
  .requiredOption("--ottl-rules <text>", "OTTL rules (newline-separated statements)")
  .option("--json", "emit machine-readable JSON")
  .action(
    async (id: string, options: { ottlRules: string; json?: boolean }) => {
      const { updateOttlRulesCommand } = await import(
        "./commands/governance/ingestion-templates.js"
      );
      await updateOttlRulesCommand(id, options);
    },
  );

templatesCmd
  .command("archive <id>")
  .description("Soft-archive an org-authored template. Platform rows reject.")
  .option("--json", "emit machine-readable JSON")
  .action(async (id: string, options: { json?: boolean }) => {
    const { archiveCommand } = await import(
      "./commands/governance/ingestion-templates.js"
    );
    await archiveCommand(id, options);
  });

templatesCmd
  .command("clone-from-platform <sourceTemplateId>")
  .description("Clone a platform-published template into the caller's org for OTTL customisation.")
  .option("--json", "emit machine-readable JSON")
  .action(
    async (sourceTemplateId: string, options: { json?: boolean }) => {
      const { cloneFromPlatformCommand } = await import(
        "./commands/governance/ingestion-templates.js"
      );
      await cloneFromPlatformCommand(sourceTemplateId, options);
    },
  );

// ── User ingestion bindings (caller's own bindings) ───────────────────────

const bindingsCmd = governanceCmd
  .command("user-ingestion-bindings")
  .description("Caller-scoped binding CRUD. Mutations require a User-bound PAT (legacy project tokens 403).");

bindingsCmd
  .command("list")
  .description("List the caller's installed bindings.")
  .option("--json", "emit machine-readable JSON")
  .action(async (options: { json?: boolean }) => {
    const { listCommand } = await import(
      "./commands/governance/user-ingestion-bindings.js"
    );
    await listCommand(options);
  });

bindingsCmd
  .command("install <templateId>")
  .description("Install a binding for an ingestion template. Returns the lwub_* token (shown once).")
  .option("--json", "emit machine-readable JSON")
  .action(async (templateId: string, options: { json?: boolean }) => {
    const { installCommand } = await import(
      "./commands/governance/user-ingestion-bindings.js"
    );
    await installCommand(templateId, options);
  });

bindingsCmd
  .command("uninstall <bindingId>")
  .description("Soft-archive a binding. Existing traces retained; new emits 401.")
  .option("--json", "emit machine-readable JSON")
  .action(async (bindingId: string, options: { json?: boolean }) => {
    const { uninstallCommand } = await import(
      "./commands/governance/user-ingestion-bindings.js"
    );
    await uninstallCommand(bindingId, options);
  });

bindingsCmd
  .command("rotate <bindingId>")
  .description("Rotate the binding's access token (hard-cut: previous token invalidated immediately).")
  .option("--json", "emit machine-readable JSON")
  .action(async (bindingId: string, options: { json?: boolean }) => {
    const { rotateCommand } = await import(
      "./commands/governance/user-ingestion-bindings.js"
    );
    await rotateCommand(bindingId, options);
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
      console.error(`Error: ${formatApiErrorMessage({ error })}`);
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
      console.error(`Error: ${formatApiErrorMessage({ error })}`);
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
      console.error(`Error: ${formatApiErrorMessage({ error })}`);
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
      console.error(`Error: ${formatApiErrorMessage({ error })}`);
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
      console.error(`Error: ${formatApiErrorMessage({ error })}`);
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
      console.error(`Error: ${formatApiErrorMessage({ error })}`);
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
      console.error(`Error: ${formatApiErrorMessage({ error })}`);
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
      console.error(`Error: ${formatApiErrorMessage({ error })}`);
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
      console.error(`Error: ${formatApiErrorMessage({ error })}`);
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
      console.error(`Error: ${formatApiErrorMessage({ error })}`);
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
      console.error(`Error: ${formatApiErrorMessage({ error })}`);
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
      console.error(`Error: ${formatApiErrorMessage({ error })}`);
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
      console.error(`Error: ${formatApiErrorMessage({ error })}`);
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

// Docs commands - fetch markdown documentation for LangWatch and Scenario
program
  .command("docs [url]")
  .description(
    "Fetch LangWatch documentation as markdown. Pass no argument for the index (llms.txt), a path like 'integration/python/guide', or a full URL. Missing extensions default to .md.",
  )
  .action(async (url?: string) => {
    try {
      const { docsCommand: impl } = await import("./commands/docs.js");
      await impl(url);
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : "Unknown error"}`);
      process.exit(1);
    }
  });

program
  .command("scenario-docs [url]")
  .description(
    "Fetch LangWatch Scenario documentation as markdown. Pass no argument for the index, a path like 'advanced/red-teaming', or a full URL. Missing extensions default to .md.",
  )
  .action(async (url?: string) => {
    try {
      const { scenarioDocsCommand: impl } = await import("./commands/docs.js");
      await impl(url);
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
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (options: { format?: string }) => {
    try {
      await listEvaluatorsCommand(options);
    } catch (error) {
      console.error(`Error: ${formatApiErrorMessage({ error })}`);
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
      console.error(`Error: ${formatApiErrorMessage({ error })}`);
      process.exit(1);
    }
  });

evaluatorCmd
  .command("create <name>")
  .description("Create a new evaluator")
  .requiredOption("--type <evaluatorType>", "Evaluator type (e.g. langevals/llm_judge)")
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (name: string, options: { type: string; format?: string }) => {
    try {
      await createEvaluatorCommand(name, options);
    } catch (error) {
      console.error(`Error: ${formatApiErrorMessage({ error })}`);
      process.exit(1);
    }
  });

evaluatorCmd
  .command("update <idOrSlug>")
  .description("Update an evaluator name or settings")
  .option("--name <name>", "New evaluator name")
  .option("--settings <json>", "Evaluator config settings as JSON")
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (idOrSlug: string, options: { name?: string; settings?: string; format?: string }) => {
    try {
      await updateEvaluatorCommand(idOrSlug, options);
    } catch (error) {
      console.error(`Error: ${formatApiErrorMessage({ error })}`);
      process.exit(1);
    }
  });

evaluatorCmd
  .command("delete <idOrSlug>")
  .description("Archive (soft-delete) an evaluator")
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (idOrSlug: string, options: { format?: string }) => {
    try {
      await deleteEvaluatorCommand(idOrSlug, options);
    } catch (error) {
      console.error(`Error: ${formatApiErrorMessage({ error })}`);
      process.exit(1);
    }
  });

// Add experiment command group — run, monitor, list, and inspect experiments
const experimentCmd = program
  .command("experiment")
  .description("Run, monitor, list, and inspect experiments");

experimentCmd
  .command("list")
  .description("List experiments in the project")
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .option("--limit <n>", "Maximum experiments to fetch (default 50, max 200)", "50")
  .action(async (options: { format?: string; limit?: string }) => {
    await experimentListCommand(options);
  });

experimentCmd
  .command("run <slug>")
  .description("Start an experiment run by slug")
  .option("--wait", "Wait for the experiment to complete before returning")
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (slug: string, options: { wait?: boolean; format?: string }) => {
    const { runExperimentCommand: impl } = await import("./commands/experiment/run.js");
    await impl(slug, options);
  });

experimentCmd
  .command("status <experiment>")
  .description("Check the status of an experiment run (defaults to the latest run)")
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .option("--run-id <id>", "Specific run id to check (defaults to the latest run)")
  .action(async (experiment: string, options: { format?: string; runId?: string }) => {
    const { experimentStatusCommand: impl } = await import("./commands/experiment/status.js");
    await impl(experiment, options);
  });

experimentCmd
  .command("list-runs <experiment>")
  .description("List experiment runs for an experiment by slug")
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .option("--limit <n>", "Maximum runs to fetch (default 50, max 200)", "50")
  .action(
    async (
      experiment: string,
      options: {
        format?: string;
        limit?: string;
      },
    ) => {
      await experimentListRunsCommand({ experiment, ...options });
    },
  );

experimentCmd
  .command("results <experiment>")
  .description(
    "Fetch per-row results for an experiment run, defaulting to the latest run (debug evaluator scores and missed rows)",
  )
  .option("--run-id <id>", "Specific run id to fetch (defaults to the latest run)")
  .option("--filter <filter>", "Filter rows: failed | all (default)", "all")
  .option("--evaluator <name>", "Show only this evaluator's column")
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .option("--limit <n>", "Maximum rows to print in table mode (default 20)", "20")
  .action(
    async (
      experiment: string,
      options: {
        runId?: string;
        filter?: string;
        evaluator?: string;
        format?: string;
        limit?: string;
      },
    ) => {
      await experimentResultsCommand({ experimentSlug: experiment, options });
    },
  );


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
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (id: string, options: { format?: string }) => {
    const { deleteWorkflowCommand: impl } = await import("./commands/workflows/delete.js");
    await impl(id, options);
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
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (name: string, options: { type: string; config?: string; format?: string }) => {
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
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (id: string, options: { name?: string; type?: string; config?: string; format?: string }) => {
    const { updateAgentCommand: impl } = await import("./commands/agents/update.js");
    await impl(id, options);
  });

agentCmd
  .command("delete <id>")
  .description("Archive (soft-delete) an agent")
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (id: string, options: { format?: string }) => {
    const { deleteAgentCommand: impl } = await import("./commands/agents/delete.js");
    await impl(id, options);
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
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (name: string, options: { format?: string }) => {
    const { createDashboardCommand: impl } = await import("./commands/dashboards/create.js");
    await impl(name, options);
  });

dashboardCmd
  .command("delete <id>")
  .description("Delete a dashboard and its graphs")
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (id: string, options: { format?: string }) => {
    const { deleteDashboardCommand: impl } = await import("./commands/dashboards/delete.js");
    await impl(id, options);
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
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (provider: string, options: { enabled?: boolean; apiKey?: string; defaultModel?: string; format?: string }) => {
    const { setModelProviderCommand: impl } = await import("./commands/model-providers/set.js");
    await impl(provider, options);
  });

// Add model-default command group (cascading default models)
const modelDefaultCmd = program
  .command("model-default")
  .description(
    "Manage cascading default models (per role/feature, per scope: project/team/organization)",
  );

modelDefaultCmd
  .command("list")
  .description("Show the effective resolution + every config you can read")
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (options: { format?: string }) => {
    const { listModelDefaultsCommand: impl } = await import(
      "./commands/model-defaults/list.js"
    );
    await impl(options);
  });

modelDefaultCmd
  .command("set <key> <model>")
  .description(
    "Set a default model for a role (DEFAULT|FAST|EMBEDDINGS) or registered feature key. Defaults to project scope; pass --scope team|organization for higher tiers.",
  )
  .option("--scope <scope>", "Scope tier: project (default), team, or organization", "project")
  .option(
    "--scope-id <id>",
    "Explicit scope id. Defaults to the API key's project / its team / its organization.",
  )
  .option("-f, --format <format>", "Output format: text (default) or json", "text")
  .action(
    async (
      key: string,
      model: string,
      options: { scope?: "project" | "team" | "organization"; scopeId?: string; format?: string },
    ) => {
      const { setModelDefaultCommand: impl } = await import(
        "./commands/model-defaults/set.js"
      );
      await impl(key, model, options);
    },
  );

modelDefaultCmd
  .command("unset <key>")
  .description("Remove a default model for a role or feature key at the chosen scope")
  .option("--scope <scope>", "Scope tier: project (default), team, or organization", "project")
  .option(
    "--scope-id <id>",
    "Explicit scope id. Defaults to the API key's project / its team / its organization.",
  )
  .option("-f, --format <format>", "Output format: text (default) or json", "text")
  .action(
    async (
      key: string,
      options: { scope?: "project" | "team" | "organization"; scopeId?: string; format?: string },
    ) => {
      const { unsetModelDefaultCommand: impl } = await import(
        "./commands/model-defaults/unset.js"
      );
      await impl(key, options);
    },
  );

// Add virtual-keys command group (AI Gateway)
const virtualKeysCmd = program
  .command("virtual-keys")
  .alias("vk")
  .description("Manage AI Gateway virtual keys (list, create, rotate, revoke)");

virtualKeysCmd
  .command("list")
  .description("List all virtual keys for the current project")
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (options: { format?: string }) => {
    const { listVirtualKeysCommand: impl } = await import("./commands/virtual-keys/list.js");
    await impl(options);
  });

virtualKeysCmd
  .command("get <id>")
  .description("Show details for a single virtual key")
  .option("-f, --format <format>", "Output format: text (default) or json", "text")
  .action(async (id: string, options: { format?: string }) => {
    const { getVirtualKeyCommand: impl } = await import("./commands/virtual-keys/get.js");
    await impl(id, options);
  });

virtualKeysCmd
  .command("create")
  .description("Create a new virtual key (secret is shown once)")
  .requiredOption("--name <name>", "Human-readable name for the key")
  .option("--description <desc>", "Optional description")
  .option("--env <env>", "Environment: live or test", "live")
  .option("--scope <typeAndId...>", "Scope row in TYPE:id form (repeatable). Types: ORG | TEAM | PROJECT. Example: --scope ORG:acme --scope TEAM:platform")
  .option("--routing-policy <id>", "RoutingPolicy id to pin (otherwise uses the org's default policy)")
  .option("--principal-user <userId>", "Mark this VK as personal and attribute spend to the named principal user")
  .option("-f, --format <format>", "Output format: text (default) or json", "text")
  .action(async (options: { name: string; description?: string; env?: "live" | "test"; scope?: string[]; routingPolicy?: string; principalUser?: string; format?: string }) => {
    const { createVirtualKeyCommand: impl } = await import("./commands/virtual-keys/create.js");
    await impl(options);
  });

virtualKeysCmd
  .command("update <id>")
  .description("Update a virtual key's name/description/scopes/routing-policy/config")
  .option("--name <name>", "New display name")
  .option("--description <desc>", "New description")
  .option("--clear-description", "Clear the description")
  .option("--scope <typeAndId...>", "Replace the scope set (repeatable; supplies the full set). Same TYPE:id form as create.")
  .option("--routing-policy <id>", "Switch to a different RoutingPolicy (pass id)")
  .option("--clear-routing-policy", "Unpin the routing policy; VK falls back to the org default ordering")
  .option("--config-json <json>", "Inline partial config JSON (model_aliases/cache/fallback/rate_limits/policy_rules). Merges with existing config")
  .option("--config-file <path>", "Read partial config JSON from a file")
  .option("-f, --format <format>", "Output format: text (default) or json", "text")
  .action(async (id: string, options: {
    name?: string;
    description?: string;
    clearDescription?: boolean;
    scope?: string[];
    routingPolicy?: string;
    clearRoutingPolicy?: boolean;
    configJson?: string;
    configFile?: string;
    format?: string;
  }) => {
    const { updateVirtualKeyCommand: impl } = await import("./commands/virtual-keys/update.js");
    await impl(id, options);
  });

virtualKeysCmd
  .command("rotate <id>")
  .description("Rotate a virtual key's secret (old secret stops working immediately)")
  .option("-f, --format <format>", "Output format: text (default) or json", "text")
  .action(async (id: string, options: { format?: string }) => {
    const { rotateVirtualKeyCommand: impl } = await import("./commands/virtual-keys/rotate.js");
    await impl(id, options);
  });

virtualKeysCmd
  .command("revoke <id>")
  .description("Revoke a virtual key (cannot be reactivated)")
  .option("-f, --format <format>", "Output format: text (default) or json", "text")
  .action(async (id: string, options: { format?: string }) => {
    const { revokeVirtualKeyCommand: impl } = await import("./commands/virtual-keys/revoke.js");
    await impl(id, options);
  });

// Add gateway-budgets command group (AI Gateway)
const gatewayBudgetsCmd = program
  .command("gateway-budgets")
  .description("Manage AI Gateway spend budgets (hierarchical scopes)");

gatewayBudgetsCmd
  .command("list")
  .description("List all budgets across scopes")
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (options: { format?: string }) => {
    const { listGatewayBudgetsCommand: impl } = await import("./commands/gateway-budgets/list.js");
    await impl(options);
  });

gatewayBudgetsCmd
  .command("create")
  .description("Create a new budget (scope + window + limit)")
  .requiredOption("--name <name>", "Human-readable budget name")
  .option("--description <desc>", "Optional description")
  .requiredOption("--scope <kind>", "Budget scope: organization|team|project|virtual-key|principal")
  .option("--organization <id>", "Organization id (for scope=organization)")
  .option("--team <id>", "Team id (for scope=team)")
  .option("--project <id>", "Project id (for scope=project)")
  .option("--virtual-key <id>", "Virtual key id (for scope=virtual-key)")
  .option("--principal <id>", "Principal user id (for scope=principal)")
  .requiredOption("--window <w>", "Budget window: minute|hour|day|week|month|total")
  .requiredOption("--limit <usd>", "Hard cap in USD (e.g. 100 or 49.99)")
  .option("--on-breach <action>", "block (default) or warn", "block")
  .option("--timezone <tz>", "IANA timezone for window boundaries (e.g. Europe/Amsterdam)")
  .option("-f, --format <format>", "Output format: text (default) or json", "text")
  .action(async (options: {
    name: string;
    description?: string;
    scope: "organization" | "team" | "project" | "virtual-key" | "principal";
    organization?: string;
    team?: string;
    project?: string;
    virtualKey?: string;
    principal?: string;
    window: string;
    limit: string;
    onBreach?: "block" | "warn";
    timezone?: string;
    format?: string;
  }) => {
    const { createGatewayBudgetCommand: impl } = await import("./commands/gateway-budgets/create.js");
    await impl(options);
  });

gatewayBudgetsCmd
  .command("update <id>")
  .description("Update a budget's name/description/limit/on-breach/timezone")
  .option("--name <name>", "New display name")
  .option("--description <desc>", "New description")
  .option("--clear-description", "Clear the description")
  .option("--limit <usd>", "New hard-cap in USD")
  .option("--on-breach <action>", "block or warn")
  .option("--timezone <tz>", "New IANA timezone")
  .option("--clear-timezone", "Clear the timezone override")
  .option("-f, --format <format>", "Output format: text (default) or json", "text")
  .action(async (id: string, options: {
    name?: string;
    description?: string;
    clearDescription?: boolean;
    limit?: string;
    onBreach?: "block" | "warn";
    timezone?: string;
    clearTimezone?: boolean;
    format?: string;
  }) => {
    const { updateGatewayBudgetCommand: impl } = await import("./commands/gateway-budgets/update.js");
    await impl(id, options);
  });

gatewayBudgetsCmd
  .command("archive <id>")
  .description("Archive a budget (stops enforcement; does not delete history)")
  .option("-f, --format <format>", "Output format: text (default) or json", "text")
  .action(async (id: string, options: { format?: string }) => {
    const { archiveGatewayBudgetCommand: impl } = await import("./commands/gateway-budgets/archive.js");
    await impl(id, options);
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
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (traceId: string, options: { comment?: string; thumbsUp?: boolean; thumbsDown?: boolean; email?: string; format?: string }) => {
    const { createAnnotationCommand: impl } = await import("./commands/annotations/create.js");
    await impl(traceId, options);
  });

annotationCmd
  .command("delete <id>")
  .description("Delete an annotation")
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (id: string, options: { format?: string }) => {
    const { deleteAnnotationCommand: impl } = await import("./commands/annotations/delete.js");
    await impl(id, options);
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
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (name: string, options: { situation: string; criteria?: string; labels?: string; format?: string }) => {
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
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (id: string, options: { name?: string; situation?: string; criteria?: string; labels?: string; format?: string }) => {
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
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (id: string, options: { format?: string }) => {
    const { deleteScenarioCommand: impl } = await import("./commands/scenarios/delete.js");
    await impl(id, options);
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
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (id: string, options: { format?: string }) => {
    const { deleteSuiteCommand: impl } = await import("./commands/suites/delete.js");
    await impl(id, options);
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
  .command("get <id>")
  .description("Get a custom graph by ID")
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (id: string, options: { format?: string }) => {
    const { getGraphCommand: impl } = await import("./commands/graphs/get.js");
    await impl(id, options);
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
  .option("--status <status>", "Filter by status (e.g. SUCCESS, FAILED, ERROR, IN_PROGRESS)")
  .option("--name <substring>", "Filter by run name substring (case-insensitive)")
  .option("--limit <n>", "Max results (default: 20)")
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (options: { scenarioSetId?: string; batchRunId?: string; status?: string; name?: string; limit?: string; format?: string }) => {
    const { listSimulationRunsCommand: impl } = await import("./commands/simulation-runs/list.js");
    await impl(options);
  });

simulationRunCmd
  .command("get <runId>")
  .description("Get full details of a simulation run (messages, results, costs)")
  .option("--full", "Show full message content instead of truncating long lines")
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (runId: string, options: { format?: string; full?: boolean }) => {
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
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (slugOrId: string, options: { format?: string }) => {
    const { deleteCommand: deleteDatasetImpl } = await import("./commands/dataset/delete.js");
    await deleteDatasetImpl(slugOrId, options);
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
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (slugOrId: string, options: { name?: string; columns?: string; format?: string }) => {
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
const projectsCmd = program
  .command("projects")
  .description("Manage organization projects");

projectsCmd
  .command("list")
  .description("List all projects in the organization")
  .option("--page <page>", "Page number", "1")
  .option("--limit <limit>", "Items per page", "50")
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (options: { page?: string; limit?: string; format?: string }) => {
    const { listProjectsCommand: impl } = await import("./commands/projects/list.js");
    await impl({
      page: options.page ? Number(options.page) : undefined,
      limit: options.limit ? Number(options.limit) : undefined,
      format: options.format,
    });
  });

projectsCmd
  .command("get <id>")
  .description("Show details for a project")
  .option("-f, --format <format>", "Output format: text (default) or json", "text")
  .action(async (id: string, options: { format?: string }) => {
    const { getProjectCommand: impl } = await import("./commands/projects/get.js");
    await impl(id, options);
  });

projectsCmd
  .command("create")
  .description("Create a new project (returns a one-time service API key)")
  .requiredOption("--name <name>", "Project name")
  .requiredOption("--language <lang>", "Programming language (e.g. python, typescript)")
  .requiredOption("--framework <fw>", "Framework (e.g. langchain, openai, vercel-ai)")
  .option("--team-id <id>", "Existing team ID to assign the project to")
  .option("--new-team-name <name>", "Create a new team with this name")
  .option("-f, --format <format>", "Output format: text (default) or json", "text")
  .action(async (options: {
    name: string;
    language: string;
    framework: string;
    teamId?: string;
    newTeamName?: string;
    format?: string;
  }) => {
    const { createProjectCommand: impl } = await import("./commands/projects/create.js");
    await impl(options);
  });

projectsCmd
  .command("update <id>")
  .description("Update a project's metadata")
  .option("--name <name>", "New project name")
  .option("--language <lang>", "New language")
  .option("--framework <fw>", "New framework")
  .option("--pii-redaction-level <level>", "PII redaction: STRICT, ESSENTIAL, or DISABLED")
  .option("-f, --format <format>", "Output format: text (default) or json", "text")
  .action(async (id: string, options: {
    name?: string;
    language?: string;
    framework?: string;
    piiRedactionLevel?: "STRICT" | "ESSENTIAL" | "DISABLED";
    format?: string;
  }) => {
    const { updateProjectCommand: impl } = await import("./commands/projects/update.js");
    await impl(id, options);
  });

projectsCmd
  .command("delete <id>")
  .description("Archive a project (soft-delete)")
  .option("-f, --format <format>", "Output format: text (default) or json", "text")
  .action(async (id: string, options: { format?: string }) => {
    const { deleteProjectCommand: impl } = await import("./commands/projects/delete.js");
    await impl(id, options);
  });

const apiKeysCmd = program
  .command("api-keys")
  .description("Manage organization API keys");

apiKeysCmd
  .command("list")
  .description("List all API keys in the organization")
  .option("-f, --format <format>", "Output format: table (default) or json", "table")
  .action(async (options: { format?: string }) => {
    const { listApiKeysCommand: impl } = await import("./commands/api-keys/list.js");
    await impl(options);
  });

apiKeysCmd
  .command("create")
  .description("Create a new API key (token is shown once)")
  .requiredOption("--name <name>", "Human-readable name for the key")
  .option("--key-type <type>", "Key type: personal or service", "service")
  .option("--description <desc>", "Optional description")
  .option("--expires-at <date>", "Expiration date (ISO 8601)")
  .option("--project-id <id...>", "Project IDs to scope the key to (service keys only, repeatable)")
  .option("-f, --format <format>", "Output format: text (default) or json", "text")
  .action(async (options: {
    name: string;
    keyType?: "personal" | "service";
    description?: string;
    expiresAt?: string;
    projectId?: string[];
    format?: string;
  }) => {
    const { createApiKeyCommand: impl } = await import("./commands/api-keys/create.js");
    await impl(options);
  });

apiKeysCmd
  .command("revoke <id>")
  .description("Revoke an API key (cannot be reactivated)")
  .option("-f, --format <format>", "Output format: text (default) or json", "text")
  .action(async (id: string, options: { format?: string }) => {
    const { revokeApiKeyCommand: impl } = await import("./commands/api-keys/revoke.js");
    await impl(id, options);
  });

program.parse(process.argv);
