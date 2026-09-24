import chalk from "chalk";

import { writeCodexOtelBlock } from "@/cli/utils/codex-config-toml";
import { reportCommandError } from "@/cli/utils/errorOutput";
import {
  type ClaudePluginEnsureAction,
  ensureLangwatchClaudePlugin,
} from "@/cli/utils/governance/claude-plugin";
import { isLoggedIn, loadConfig, saveConfig } from "@/cli/utils/governance/config";
import { installOpencodeSessionContextPlugin } from "@/cli/utils/governance/opencode-plugin";
import { TOOL_BY_SOURCE_TYPE } from "@/cli/utils/governance/otel-env-block";
import { installSessionContextHooks } from "@/cli/utils/governance/session-context-hooks";
import {
  CODEX_TURN_HARVEST_BLOCKED_MESSAGE,
  type CodexTurnHarvestOutcome,
  installCodexTurnHarvest,
} from "@/cli/utils/governance/shell-rc";
import { resolveIngestionCredential } from "@/cli/utils/governance/telemetry-refresh";

/**
 * Path B activation: mint key, export OTLP, wire out-of-band activation.
 * Forward-compatible: new tools need one-line edits.
 */

const SUPPORTED_TOOLS = ["codex", "claude_code", "gemini", "opencode"] as const;
type SupportedTool = (typeof SUPPORTED_TOOLS)[number];

export interface InstallOptions {
  json?: boolean;
  /** Suppress the config-file writes; useful for previewing exports only. */
  envOnly?: boolean;
  /**
   * Override the codex config.toml path. Test-only — exposed because
   * the codex-config-toml helper accepts it but the CLI surface
   * keeps the default unless explicitly threaded through.
   */
  codexConfigPath?: string;
  /**
   * Override the hook file the session context hooks are merged into
   * (claude's settings.json, codex's hooks.json). Test-only, same reason.
   */
  hooksPath?: string;
  /** Override the opencode plugins directory. Test-only, same reason. */
  opencodePluginDir?: string;
}

interface InstallReport {
  tool: SupportedTool;
  source_type: string;
  endpoint: string;
  ingestion_token: string;
  token_prefix: string;
  /** Where the telemetry lands: a pinned team project, or the personal one. */
  scope: "project" | "personal";
  /** The pinned project's slug or id, when the scope is a project. */
  destination_project?: string;
  codex_config_action?: "created" | "updated" | "unchanged";
  codex_config_path?: string;
  /**
   * How codex was left with respect to running the harvest after a completed
   * turn, which is the only thing that recovers the conversation its telemetry
   * carries none of.
   */
  codex_turn_harvest_action?: CodexTurnHarvestOutcome["status"];
  /**
   * How the tool's session context seam was left: hook entries for
   * claude_code/codex, the plugin file for opencode. Absent when the Claude
   * Code plugin took the install, leaving nothing in settings to report.
   */
  session_hooks_action?: "created" | "updated" | "unchanged";
  session_hooks_path?: string;
  /**
   * What became of the Claude Code plugin, claude_code only, when the run
   * wired something. Anything other than `installed`/`already_installed`
   * means raw hooks ran as fallback -- see `session_hooks_action`.
   */
  claude_plugin_action?: ClaudePluginEnsureAction;
  env_block: string[];
}

export async function installCommand(toolArg: string, options: InstallOptions = {}): Promise<void> {
  const cfg = loadConfig();
  if (!isLoggedIn(cfg)) {
    process.stderr.write("Not logged in. Run `langwatch login --device` first.\n");
    process.exit(1);
    return;
  }

  const tool = normaliseTool(toolArg);
  if (!tool) {
    process.stderr.write(`Unknown tool '${toolArg}'. Supported: ${SUPPORTED_TOOLS.join(", ")}.\n`);
    process.exit(1);
    return;
  }

  try {
    const report = await runInstall(cfg, tool, options);
    if (options.json) {
      process.stdout.write(JSON.stringify(report, null, 2) + "\n");
      return;
    }
    renderHumanReport(report);
  } catch (err) {
    reportCommandError({ error: err, format: options.json ? "json" : undefined });
    process.exit(1);
  }
}

function normaliseTool(raw: string): SupportedTool | null {
  const slug = raw.trim().toLowerCase().replace(/-/g, "_");
  return (SUPPORTED_TOOLS as readonly string[]).includes(slug) ? (slug as SupportedTool) : null;
}

async function runInstall(
  cfg: ReturnType<typeof loadConfig>,
  tool: SupportedTool,
  options: InstallOptions,
): Promise<InstallReport> {
  // Resolves the ingest key the same way the wrappers do, so a team-pinned
  // tool keeps that scope. Without a pin, falls back to the personal key
  // with reuse-first rules: cached-and-live wins, a revoked/missing one mints fresh.
  const { token, prefix, endpoint, minted, scope, projectLabel } = await resolveIngestionCredential(
    {
      cfg,
      tool: TOOL_BY_SOURCE_TYPE[tool] ?? tool,
      sourceType: tool,
    },
  );
  const envBlock = buildEnvBlock(tool, endpoint, token);

  // A fresh mint revokes the tool's previous key, so the config cache is now
  // stale and everything reading it (the wrapper's reuse path, the
  // session-context hook's fallback target) would authenticate with a dead
  // key. Best-effort: a config we cannot write is not a reason to fail an
  // install that worked.
  if (minted) {
    try {
      saveConfig({
        ...cfg,
        default_personal_ingest_keys: {
          ...cfg.default_personal_ingest_keys,
          [tool]: { secret: token, prefix },
        },
      });
    } catch {
      // The env block above is still valid; only the cache went unwritten.
      void 0;
    }
  }

  const report: InstallReport = {
    tool,
    source_type: tool,
    endpoint,
    ingestion_token: token,
    token_prefix: prefix ?? token.slice(0, 12),
    scope,
    destination_project: projectLabel,
    env_block: envBlock,
  };

  if (tool === "codex" && !options.envOnly) {
    const result = writeCodexOtelBlock(
      {
        baseEndpoint: endpoint,
        ingestionToken: token,
        environment: cfg.organization?.slug ?? "langwatch",
      },
      { filePath: options.codexConfigPath },
    );
    report.codex_config_action = result.action;
    report.codex_config_path = result.path;

    // Codex exports no conversation, so telemetry alone leaves this install
    // with traces nobody can read. Running this command IS the consent for the
    // program codex then runs after each turn, which is what makes capture
    // reachable from a script with no terminal to answer a prompt.
    report.codex_turn_harvest_action = installCodexTurnHarvest({
      filePath: options.codexConfigPath,
    }).status;
  }

  // Every agent knows which repository, branch and worktree a session runs in
  // and exports none of it over telemetry. The session context seam is what
  // reports it, so activating capture installs it alongside the export block.
  if (!options.envOnly) {
    // Claude Code takes the seam as a plugin, which carries its own copy of the
    // hook command and so never breaks when the CLI on PATH is older than the
    // subcommand a raw entry names. The entries stay as the fallback for a
    // `claude` that cannot take a plugin, and the report says which one ran.
    let isClaudePluginHandlingHooks = false;
    if (tool === "claude_code") {
      const plugin = ensureLangwatchClaudePlugin({ interactive: true });
      report.claude_plugin_action = plugin.action;
      isClaudePluginHandlingHooks =
        plugin.action === "installed" || plugin.action === "already_installed";
    }

    if ((tool === "claude_code" && !isClaudePluginHandlingHooks) || tool === "codex") {
      const result = installSessionContextHooks({
        tool,
        filePath: options.hooksPath,
      });
      report.session_hooks_action = result.action;
      report.session_hooks_path = result.displayPath;
    }

    if (tool === "opencode") {
      const result = installOpencodeSessionContextPlugin({
        dirPath: options.opencodePluginDir,
      });
      report.session_hooks_action = result.action;
      report.session_hooks_path = result.displayPath;
    }
  }

  return report;
}

function buildEnvBlock(tool: SupportedTool, endpoint: string, token: string): string[] {
  const base = [
    `export OTEL_EXPORTER_OTLP_ENDPOINT="${endpoint}"`,
    `export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer ${token}"`,
  ];

  switch (tool) {
    case "codex":
      return [
        `export OTEL_TRACES_EXPORTER=otlp`,
        `export OTEL_EXPORTER_OTLP_PROTOCOL=http/json`,
        ...base,
        `export OTEL_RESOURCE_ATTRIBUTES="service.name=codex"`,
      ];
    case "claude_code":
      return [
        `export CLAUDE_CODE_ENABLE_TELEMETRY=1`,
        // Enhanced-telemetry beta unlocks span-tracing carrying agent_id +
        // parent_agent_id, the only signal tying a model/tool call to its
        // sub-agent. Without it, every sub-agent collapses into one
        // synthesized per-turn trace; content still rides the log events.
        `export CLAUDE_CODE_ENHANCED_TELEMETRY_BETA=1`,
        // OTel content unlock knobs: log prompts, tool details, tool content, api bodies
        `export OTEL_LOG_USER_PROMPTS=1`,
        `export OTEL_LOG_TOOL_DETAILS=1`,
        `export OTEL_LOG_TOOL_CONTENT=1`,
        `export OTEL_LOG_RAW_API_BODIES=1`,
        `export OTEL_TRACES_EXPORTER=otlp`,
        `export OTEL_LOGS_EXPORTER=otlp`,
        `export OTEL_METRICS_EXPORTER=otlp`,
        `export OTEL_EXPORTER_OTLP_PROTOCOL=http/json`,
        ...base,
        `export OTEL_RESOURCE_ATTRIBUTES="service.name=claude-code"`,
      ];
    case "gemini":
      return [
        `export GEMINI_TELEMETRY_ENABLED=true`,
        `export GEMINI_TELEMETRY_TARGET=local`,
        `export GEMINI_TELEMETRY_USE_COLLECTOR=true`,
        `export GEMINI_TELEMETRY_TRACES_ENABLED=true`,
        `export GEMINI_TELEMETRY_OTLP_PROTOCOL=http`,
        `export GEMINI_TELEMETRY_OTLP_ENDPOINT="${endpoint}"`,
        `export GEMINI_TELEMETRY_LOG_PROMPTS=true`,
        `export OTEL_TRACES_EXPORTER=otlp`,
        `export OTEL_EXPORTER_OTLP_PROTOCOL=http/json`,
        ...base,
        `export OTEL_RESOURCE_ATTRIBUTES="service.name=gemini-cli"`,
      ];
    case "opencode":
      return [
        `export OTEL_TRACES_EXPORTER=otlp`,
        `export OTEL_LOGS_EXPORTER=otlp`,
        `export OTEL_METRICS_EXPORTER=otlp`,
        `export OTEL_EXPORTER_OTLP_PROTOCOL=http/json`,
        ...base,
        `export OTEL_RESOURCE_ATTRIBUTES="service.name=opencode"`,
      ];
  }
}

function renderHumanReport(report: InstallReport): void {
  process.stdout.write(`${chalk.green("✓")} Minted ingestion key for ${chalk.bold(report.tool)}\n`);
  process.stdout.write(`  endpoint: ${report.endpoint}\n`);
  process.stdout.write(`  token:    ${report.ingestion_token}\n`);

  if (report.codex_config_action) {
    const verb2 =
      report.codex_config_action === "created" || report.codex_config_action === "updated"
        ? report.codex_config_action
        : "already up to date";
    process.stdout.write(`${chalk.green("✓")} ${report.codex_config_path} ${verb2}\n`);
  }

  if (
    report.claude_plugin_action === "installed" ||
    report.claude_plugin_action === "already_installed"
  ) {
    const pluginVerb =
      report.claude_plugin_action === "installed" ? "installed" : "already up to date";
    process.stdout.write(`${chalk.green("✓")} LangWatch Claude Code plugin ${pluginVerb}\n`);
  }

  renderCodexTurnHarvest(report);

  if (report.session_hooks_action) {
    const hooksVerb =
      report.session_hooks_action === "unchanged"
        ? "already up to date"
        : report.session_hooks_action;
    const what = report.tool === "opencode" ? "session plugin" : "session hooks";
    process.stdout.write(`${chalk.green("✓")} ${report.session_hooks_path} ${what} ${hooksVerb}\n`);
  }

  process.stdout.write("\nAdd to your shell rc (or run in this shell):\n");
  for (const line of report.env_block) {
    process.stdout.write(`  ${line}\n`);
  }

  renderToolInstallationNotes(report);
}

function renderCodexTurnHarvest(report: InstallReport): void {
  if (report.codex_turn_harvest_action === "installed") {
    process.stdout.write(
      `${chalk.green("✓")} Codex will record each turn's conversation as it completes\n`,
    );
  } else if (report.codex_turn_harvest_action === "blocked") {
    process.stdout.write(`${chalk.yellow("!")} ${CODEX_TURN_HARVEST_BLOCKED_MESSAGE}\n`);
  }
}

function renderToolInstallationNotes(report: InstallReport): void {
  if (report.tool === "codex") {
    process.stdout.write(
      `\nThe [otel] activation block in your codex config.toml has been wired automatically.\n`,
    );
    if (report.session_hooks_action) {
      process.stdout.write(
        `\nSession hooks were added to your Codex hooks file, so every session reports\n` +
          `the repository, branch and worktree it ran in. Your own hooks are untouched.\n` +
          `Codex asks you to review a newly added hook the next time you start it, and it\n` +
          `will not run until you do.\n`,
      );
    }
  } else if (report.tool === "claude_code") {
    if (report.claude_plugin_action === "installed") {
      process.stdout.write(
        `\nThe LangWatch plugin was added to Claude Code, so every session reports the\n` +
          `repository, branch and worktree it ran in. Run \`langwatch logout\` to remove it.\n`,
      );
    } else if (report.session_hooks_action) {
      process.stdout.write(
        `\nSession hooks were added to your Claude Code settings, so every session reports\n` +
          `the repository, branch and worktree it ran in. Your own hooks are untouched.\n`,
      );
    }
  } else if (report.tool === "opencode") {
    if (report.session_hooks_action) {
      process.stdout.write(
        `\nA session plugin was added to your opencode plugins directory, so every session\n` +
          `reports the repository, branch and worktree it ran in. Your own plugins are\n` +
          `untouched.\n`,
      );
    }
    process.stdout.write(
      `\nNote: opencode 1.14 emits structural spans but no gen_ai.* attributes yet.\n` +
        `Spans will land but per-call tokens/model/cost wait on upstream semconv support.\n`,
    );
  }
}
