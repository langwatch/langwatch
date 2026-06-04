import chalk from "chalk";

import {
  GovernanceCliError,
  installUserIngestionBinding,
  listIngestionTemplates,
  listUserIngestionBindings,
  rotateUserIngestionBindingToken,
} from "@/cli/utils/governance/cli-api";
import { isLoggedIn, loadConfig } from "@/cli/utils/governance/config";
import { writeCodexOtelBlock } from "@/cli/utils/codex-config-toml";

/**
 * `langwatch ingestion install <tool>` — Path B activation flow.
 *
 * Distinct from the gateway-only `langwatch <tool>` wrapper (Path A).
 * Installs the user's IngestionTemplate binding, prints the OTLP
 * export block, and — for codex specifically — idempotently merges
 * the [otel] activation block into ~/.codex/config.toml so the user
 * pastes nothing manual.
 *
 * Tools handled today:
 *   - codex      : toml merge + env exports
 *   - claude_code: env exports (no toml needed)
 *   - gemini     : env exports (no toml needed; envs are read directly)
 *   - opencode   : env exports (no toml needed)
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
  /** Suppress the toml write; useful for previewing exports only. */
  envOnly?: boolean;
  /**
   * Override the codex config.toml path. Test-only — exposed because
   * the codex-config-toml helper accepts it but the CLI surface
   * keeps the default unless explicitly threaded through.
   */
  codexConfigPath?: string;
}

interface InstallReport {
  tool: SupportedTool;
  template_id: string;
  template_slug: string;
  endpoint: string;
  ingestion_token: string;
  token_action: "minted" | "rotated";
  codex_config_action?: "created" | "updated" | "unchanged";
  codex_config_path?: string;
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
  const templates = await listIngestionTemplates(cfg);
  const template = templates.find((t) => t.slug === tool);
  if (!template) {
    throw new GovernanceCliError(
      404,
      "template_not_found",
      `No IngestionTemplate found with slug '${tool}'. The catalog seed may not have run on this control plane yet.`,
    );
  }

  // Mint a fresh binding OR rotate the existing one. Both paths
  // yield a plaintext ik-lw-* token that we can write straight into
  // the export block. We deliberately rotate rather than fetching a
  // stored secret because the secret is only ever visible at mint
  // time — re-running the install command should always leave the
  // user with a working token.
  const existing = await listUserIngestionBindings(cfg);
  const prior = existing.find((b) => b.template_id === template.id);

  let token: string;
  let action: "minted" | "rotated";
  if (prior) {
    const r = await rotateUserIngestionBindingToken(cfg, prior.id);
    token = r.binding_access_token;
    action = "rotated";
  } else {
    const r = await installUserIngestionBinding(cfg, template.id);
    token = r.binding_access_token;
    action = "minted";
  }

  const endpoint = `${cfg.control_plane_url.replace(/\/+$/, "")}/api/otel`;
  const envBlock = buildEnvBlock(tool, endpoint, token);

  const report: InstallReport = {
    tool,
    template_id: template.id,
    template_slug: template.slug,
    endpoint,
    ingestion_token: token,
    token_action: action,
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
        // Without OTEL_LOG_USER_PROMPTS=1 claude code redacts the
        // prompt body, leaving /me/traces with empty input. Mirror
        // the wrapper + drawer + docs which all set this.
        `export OTEL_LOG_USER_PROMPTS=1`,
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
        `export GEMINI_TELEMETRY_OTLP_PROTOCOL=http`,
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
  const verb = report.token_action === "minted" ? "Installed" : "Rotated";
  process.stdout.write(
    `${chalk.green("✓")} ${verb} ingestion binding for ${chalk.bold(report.tool)}\n`,
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

  process.stdout.write("\nAdd to your shell rc (or run in this shell):\n");
  for (const line of report.env_block) {
    process.stdout.write(`  ${line}\n`);
  }

  if (report.tool === "codex") {
    process.stdout.write(
      `\nThe [otel] activation block in your codex config.toml has been wired automatically.\n`,
    );
  } else if (report.tool === "opencode") {
    process.stdout.write(
      `\nNote: opencode 1.14 emits structural spans but no gen_ai.* attributes yet.\n` +
        `Spans will land but per-call tokens/model/cost wait on upstream semconv support.\n`,
    );
  }
}
