import chalk from "chalk";

import {
  GovernanceCliError,
  mintIngestionKey,
} from "@/cli/utils/governance/cli-api";
import {
  type ClaudePluginEnsureAction,
  ensureLangwatchClaudePlugin,
} from "@/cli/utils/governance/claude-plugin";
import {
  isLoggedIn,
  loadConfig,
  saveConfig,
} from "@/cli/utils/governance/config";
import { installOpencodeSessionContextPlugin } from "@/cli/utils/governance/opencode-plugin";
import { installSessionContextHooks } from "@/cli/utils/governance/session-context-hooks";
import { writeCodexOtelBlock } from "@/cli/utils/codex-config-toml";

/**
 * `langwatch ingest install <tool>` — Path B activation flow.
 *
 * Distinct from the gateway-only `langwatch <tool>` wrapper (Path A).
 * Mints the user's personal ingest key (sk-lw-*), prints the OTLP
 * export block, and wires whatever out-of-band activation the tool
 * needs so the user pastes nothing manual.
 *
 * Tools handled today:
 *   - codex      : toml merge + env exports + the session context hooks
 *                  merged into the codex hooks.json
 *   - claude_code: env exports + the session context hooks merged into
 *                  ~/.claude/settings.json
 *   - gemini     : env exports (no toml needed; envs are read directly)
 *   - opencode   : env exports + the session context plugin written into
 *                  the opencode plugins directory
 *
 * Returning early when the slug isn't recognised keeps the surface
 * forward-compatible — adding a new template is a one-line edit
 * here once we know whether it needs an out-of-band activation step.
 */

const SUPPORTED_TOOLS = [
  "codex",
  "claude_code",
  "gemini",
  "opencode",
] as const;
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
  codex_config_action?: "created" | "updated" | "unchanged";
  codex_config_path?: string;
  /**
   * How the tool's session context seam was left: the hook entries for
   * claude_code and codex, the plugin file for opencode. Absent for a
   * claude_code install the Claude Code plugin took, which carries the same
   * hooks and so leaves nothing in the settings file to report.
   */
  session_hooks_action?: "created" | "updated" | "unchanged";
  session_hooks_path?: string;
  /**
   * What became of the LangWatch Claude Code plugin, for claude_code only.
   * Anything other than `installed` / `already_installed` means the raw hook
   * entries ran as the fallback, and `session_hooks_action` says what they did.
   */
  claude_plugin_action?: ClaudePluginEnsureAction;
  env_block: string[];
}

export async function installCommand(
  toolArg: string,
  options: InstallOptions = {},
): Promise<void> {
  const cfg = loadConfig();
  if (!isLoggedIn(cfg)) {
    process.stderr.write(
      "Not logged in. Run `langwatch login --device` first.\n",
    );
    process.exit(1);
    return;
  }

  const tool = normaliseTool(toolArg);
  if (!tool) {
    process.stderr.write(
      `Unknown tool '${toolArg}'. Supported: ${SUPPORTED_TOOLS.join(", ")}.\n`,
    );
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
    const msg = err instanceof GovernanceCliError ? err.message : String(err);
    process.stderr.write(`Error: ${msg}\n`);
    process.exit(1);
  }
}

function normaliseTool(raw: string): SupportedTool | null {
  const slug = raw.trim().toLowerCase().replace(/-/g, "_");
  return (SUPPORTED_TOOLS as readonly string[]).includes(slug)
    ? (slug as SupportedTool)
    : null;
}

async function runInstall(
  cfg: ReturnType<typeof loadConfig>,
  tool: SupportedTool,
  options: InstallOptions,
): Promise<InstallReport> {
  // Mint a fresh personal ingest key (sk-lw-*) for this tool's
  // source_type. The plaintext key is only ever visible at mint
  // time, so re-running the install command always leaves the user
  // with a working key written straight into the export block. The
  // SupportedTool slug doubles as the source_type the mint route
  // expects (claude_code / codex / gemini / opencode).
  const { token, prefix, endpoint } = await mintIngestionKey(cfg, tool);
  const envBlock = buildEnvBlock(tool, endpoint, token);

  // Minting revokes the tool's previous key, so the config cache is now stale
  // and everything reading it (the wrapper's reuse path, the session-context
  // hook's fallback target) would authenticate with a dead key. Best-effort:
  // a config we cannot write is not a reason to fail an install that worked.
  try {
    saveConfig({
      ...cfg,
      default_personal_ingest_keys: {
        ...(cfg.default_personal_ingest_keys ?? {}),
        [tool]: { secret: token, prefix },
      },
    });
  } catch {
    // The env block above is still valid; only the cache went unwritten.
  }

  const report: InstallReport = {
    tool,
    source_type: tool,
    endpoint,
    ingestion_token: token,
    token_prefix: prefix,
    env_block: envBlock,
  };

  if (tool === "codex" && !options.envOnly) {
    // codex's OTLP/HTTP exporter sends every signal to the configured
    // endpoint verbatim — it does NOT append `/v1/traces` the way the
    // OTel SDKs do. Spell the trace-signal suffix out (mirror of the
    // wrapper-mode.ts behaviour) so the POST lands on the real handler.
    const result = writeCodexOtelBlock(
      {
        endpoint: `${endpoint}/v1/traces`,
        ingestionToken: token,
        environment: cfg.organization?.slug ?? "langwatch",
      },
      { filePath: options.codexConfigPath },
    );
    report.codex_config_action = result.action;
    report.codex_config_path = result.path;
  }

  // Every agent knows which repository, branch and worktree a session runs in
  // and exports none of it over telemetry. The session context seam is what
  // reports it, so activating capture installs it alongside the export block.
  if (!options.envOnly) {
    // Claude Code takes the seam as a plugin, which carries its own copy of the
    // hook command and so never breaks when the CLI on PATH is older than the
    // subcommand a raw entry names. The entries stay as the fallback for a
    // `claude` that cannot take a plugin, and the report says which one ran.
    let claudePluginTookTheHooks = false;
    if (tool === "claude_code") {
      const plugin = ensureLangwatchClaudePlugin({ interactive: true });
      report.claude_plugin_action = plugin.action;
      claudePluginTookTheHooks =
        plugin.action === "installed" || plugin.action === "already_installed";
    }

    if ((tool === "claude_code" && !claudePluginTookTheHooks) || tool === "codex") {
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

function buildEnvBlock(
  tool: SupportedTool,
  endpoint: string,
  token: string,
): string[] {
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
        // Enhanced-telemetry beta: unlocks the real span-tracing signal
        // (scope com.anthropic.claude_code.tracing — llm_request / tool /
        // subagent.spawn spans) carrying agent_id + parent_agent_id, the
        // only telemetry that ties a model call / tool run to the sub-agent
        // that issued it. Without it OTEL_TRACES_EXPORTER is a no-op and the
        // receiver collapses every sub-agent into one synthesized per-turn
        // trace. Content still rides the log events, joined by request_id.
        `export CLAUDE_CODE_ENHANCED_TELEMETRY_BETA=1`,
        // OTel content unlock knobs (all ON, collect-everything):
        //   OTEL_LOG_USER_PROMPTS=1     lifts user prompt text onto user_prompt events
        //   OTEL_LOG_TOOL_DETAILS=1     lifts tool metadata expansion onto tool_* events
        //   OTEL_LOG_TOOL_CONTENT=1     lifts tool_input (Bash command, Edit diff, file
        //                               paths) onto tool_decision + tool_result so the
        //                               trace shows WHAT the tool did
        //   OTEL_LOG_RAW_API_BODIES=1   emits api_request_body + api_response_body
        //                               events carrying the FULL JSON of every claude
        //                               API call: system prompts, rolling message
        //                               history, assistant response text + reasoning,
        //                               tool_use blocks. THIS is the only OTel surface
        //                               that carries assistant text. May include PII /
        //                               secrets a user pasted into a prompt; payloads
        //                               can grow large turn-over-turn — the langwatch
        //                               receiver caps oversized bodies before they
        //                               reach storage to keep the CH merge ceiling safe.
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
  process.stdout.write(
    `${chalk.green("✓")} Minted ingestion key for ${chalk.bold(report.tool)}\n`,
  );
  process.stdout.write(`  endpoint: ${report.endpoint}\n`);
  process.stdout.write(`  token:    ${report.ingestion_token}\n`);

  if (report.codex_config_action) {
    const verb2 =
      report.codex_config_action === "created"
        ? "created"
        : report.codex_config_action === "updated"
          ? "updated"
          : "already up to date";
    process.stdout.write(
      `${chalk.green("✓")} ${report.codex_config_path} ${verb2}\n`,
    );
  }

  if (
    report.claude_plugin_action === "installed" ||
    report.claude_plugin_action === "already_installed"
  ) {
    const pluginVerb =
      report.claude_plugin_action === "installed"
        ? "installed"
        : "already up to date";
    process.stdout.write(
      `${chalk.green("✓")} LangWatch Claude Code plugin ${pluginVerb}\n`,
    );
  }

  if (report.session_hooks_action) {
    const hooksVerb =
      report.session_hooks_action === "unchanged"
        ? "already up to date"
        : report.session_hooks_action;
    const what = report.tool === "opencode" ? "session plugin" : "session hooks";
    process.stdout.write(
      `${chalk.green("✓")} ${report.session_hooks_path} ${what} ${hooksVerb}\n`,
    );
  }

  process.stdout.write("\nAdd to your shell rc (or run in this shell):\n");
  for (const line of report.env_block) {
    process.stdout.write(`  ${line}\n`);
  }

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
