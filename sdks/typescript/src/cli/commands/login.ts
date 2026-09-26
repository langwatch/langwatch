import * as fs from "fs";
import * as path from "path";

import chalk from "chalk";
import prompts from "prompts";

import { recordCliLocation } from "@/cli/utils/governance/cli-location";
import { isLoggedIn, loadConfig, saveConfig } from "@/cli/utils/governance/config";
import {
  globalConfigIsolationWarning,
  rewritesGlobalConfigForLocalInstance,
} from "@/cli/utils/governance/global-config-isolation";
import { runDeviceFlowLogin, runUnifiedLoginFlow } from "@/cli/utils/governance/login-flow";
import { resolveControlPlaneEndpoint } from "@/cli/utils/governance/resolveEndpoint";
import { fetchProjectKeyBySlug, SessionApiError } from "@/cli/utils/governance/session-api";
import { rememberProjectName } from "@/cli/utils/identityNotice";
import { formatApiErrorMessage } from "@/client-sdk/services/_shared/format-api-error";
import { DEFAULT_ENDPOINT } from "@/internal/constants";
import { normalizeEndpoint } from "@/internal/endpoint";

/**
 * Agent-hint banner with escape-hatch flags (--device, --project).
 * Spec: specs/ai-governance/cli-onboarding/login-unified.feature
 */
function printAgentHintBanner(): void {
  console.log(
    chalk.gray(
      "Running interactively. To skip these prompts (CI / agents that already have a credential):",
    ),
  );
  console.log(
    chalk.gray("  --device                   AI tools / SSO (claude, codex, gemini, opencode)"),
  );
  console.log(chalk.gray("  --device --manage-teams    same, and the key can also manage teams"));
  console.log(
    chalk.gray(
      "  --project [slug]           project SDK key into .env; with a slug, no browser (uses your device login)",
    ),
  );
  console.log(
    chalk.gray("  --api-key <KEY>            project SDK key you already have, into .env"),
  );
  console.log(
    chalk.gray(
      "  --token <TOKEN>            pre-minted device session (writes ~/.langwatch/config.json)",
    ),
  );
  console.log(chalk.gray("  --endpoint <URL>           self-hosted instance URL"));
  console.log();
}

/**
 * Warns once, on stderr, that a local control plane now owns the machine's
 * one global config. Spec: specs/ai-governance/cli-onboarding/login-unified.feature
 */
const warnIfLocalEndpointTakesOverGlobalConfig = (endpoint: string): void => {
  if (!rewritesGlobalConfigForLocalInstance({ endpoint })) return;
  console.error(chalk.yellow(globalConfigIsolationWarning(endpoint)));
};

const updateEnvFile = (apiKey: string): { created: boolean; updated: boolean; path: string } => {
  const envPath = path.join(process.cwd(), ".env");

  // Check if .env exists
  if (!fs.existsSync(envPath)) {
    // Create new .env file
    fs.writeFileSync(envPath, `LANGWATCH_API_KEY=${apiKey}\n`);
    return { created: true, updated: false, path: envPath };
  }

  // Read existing .env file
  const content = fs.readFileSync(envPath, "utf-8");
  const lines = content.split("\n");

  // Check if LANGWATCH_API_KEY already exists and update it
  let found = false;
  const updatedLines = lines.map((line) => {
    if (line.startsWith("LANGWATCH_API_KEY=")) {
      found = true;
      return `LANGWATCH_API_KEY=${apiKey}`;
    }
    return line;
  });

  if (!found) {
    // Add to end of file
    if (content.endsWith("\n") || content === "") {
      updatedLines.push(`LANGWATCH_API_KEY=${apiKey}`);
    } else {
      updatedLines.push("", `LANGWATCH_API_KEY=${apiKey}`);
    }
  }

  fs.writeFileSync(envPath, updatedLines.join("\n"));
  return { created: false, updated: found, path: envPath };
};

/**
 * Headless guidance for project login: a device-code poll can hang ten
 * minutes in a VM/CI, so a non-TTY caller fails fast and names every path.
 * Spec: specs/ai-governance/cli-onboarding/login-unified.feature
 */
const failFastHeadlessProjectLogin = (): never => {
  console.error(chalk.red("Error: project login needs a browser, and this terminal has no TTY."));
  console.error(chalk.gray("Non-interactive options:"));
  console.error(
    chalk.cyan("  langwatch login --project <slug>") +
      chalk.gray("   uses your existing device login, no browser"),
  );
  console.error(
    chalk.cyan("  langwatch login --api-key <key>") +
      chalk.gray("    writes a key you already have to .env"),
  );
  console.error(
    chalk.cyan("  export LANGWATCH_API_KEY=<key>") + chalk.gray("     or put it in .env yourself"),
  );
  console.error(
    chalk.gray(
      "In a terminal with a browser, `langwatch login --project` picks the project interactively.",
    ),
  );
  process.exit(1);
};

/**
 * Non-interactive project login: trades the device session for the named
 * project's existing API key over POST /api/auth/cli/project-key and writes
 * it to $CWD/.env. No browser, no prompts, works headless.
 */
const loginToProjectBySlug = async (slug: string): Promise<void> => {
  const cfg = loadConfig();
  if (!isLoggedIn(cfg)) {
    console.error(chalk.red("Error: `--project <slug>` needs a device login to authenticate you."));
    console.error(
      chalk.gray("Run ") +
        chalk.cyan("langwatch login") +
        chalk.gray(" in a terminal with a browser first, or use ") +
        chalk.cyan("langwatch login --api-key <key>"),
    );
    process.exit(1);
  }
  try {
    const result = await fetchProjectKeyBySlug(cfg, slug);
    rememberProjectName(result.api_key, result.project.name);
    const envResult = updateEnvFile(result.api_key);
    console.log(
      chalk.green(`✓ API key for project ${chalk.bold(result.project.name)} saved to .env`),
    );
    if (envResult.created) {
      console.log(chalk.gray(`  • Created .env file at ${envResult.path}`));
    } else if (envResult.updated) {
      console.log(chalk.gray(`  • Updated existing API key in ${envResult.path}`));
    } else {
      console.log(chalk.gray(`  • Added API key to ${envResult.path}`));
    }
    console.log(chalk.gray(`  Project: ${result.project.name} (${result.project.slug})`));
    console.log(chalk.gray(`  Dashboard: ${cfg.control_plane_url}`));
  } catch (error) {
    if (error instanceof SessionApiError) {
      console.error(chalk.red(`Error: ${error.message}`));
      if (error.code === "project_not_found") {
        console.error(
          chalk.gray(
            "Check the slug in the dashboard URL, or run `langwatch login --project` in a browser-able terminal to pick from a list.",
          ),
        );
      }
      process.exit(1);
    }
    throw error;
  }
};

function persistPresetEndpoint(flagEndpoint: string | undefined): void {
  const presetEndpoint = flagEndpoint ?? process.env.LANGWATCH_ENDPOINT?.trim();
  if (!presetEndpoint) return;
  const trimmed = normalizeEndpoint(presetEndpoint);
  const cfg = loadConfig();
  cfg.control_plane_url = trimmed;
  saveConfig(cfg);
  warnIfLocalEndpointTakesOverGlobalConfig(trimmed);
}

function saveDeviceSessionToken(rawToken: string): void {
  const token = rawToken.trim();
  if (token.length < 10) {
    console.error(chalk.red("Error: token seems too short. Please check and try again."));
    process.exit(1);
  }
  const cfg = loadConfig();
  cfg.access_token = token;
  // No refresh_token / expires_at — that's the trade-off of bypassing
  // the device flow. The wrapper auto-login will mint a real session
  // if this token expires, since loadConfig+isLoggedIn only checks
  // access_token presence.
  saveConfig(cfg);
  console.log(chalk.green("✓ device-session token saved"));
  console.log(chalk.gray("  ~/.langwatch/config.json"));
}

function saveApiKeyFlag(rawApiKey: string): void {
  const apiKey = rawApiKey.trim();
  if (apiKey.length < 10) {
    console.error(chalk.red("Error: API key seems too short. Please check and try again."));
    process.exit(1);
  }

  const envResult = updateEnvFile(apiKey);
  console.log(chalk.green("API key saved successfully."));
  if (envResult.created) {
    console.log(chalk.gray(`Created .env file at ${envResult.path}`));
  } else if (envResult.updated) {
    console.log(chalk.gray(`Updated existing API key in ${envResult.path}`));
  } else {
    console.log(chalk.gray(`Added API key to ${envResult.path}`));
  }
}

const validateEndpointUrl = (v: string): string | true => {
  try {
    const parsed = new URL(v);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "URL must start with http(s)://";
    }
    return true;
  } catch {
    return "URL must be absolute (https://...)";
  }
};

/** Asks cloud or self-hosted, and persists the answer so every later resolver targets it. */
async function chooseEndpoint(): Promise<void> {
  // When the user already resolved a non-cloud endpoint (local dev or a
  // self-hosted deployment via LANGWATCH_ENDPOINT or persisted config),
  // default to keeping it but still offer to switch endpoint or jump to
  // Cloud. On a fresh install Cloud stays the priority default.
  const current = resolveControlPlaneEndpoint();
  const hasCustomEndpoint = current.url !== DEFAULT_ENDPOINT;

  const cloudChoice = {
    title: "LangWatch Cloud",
    description: "app.langwatch.ai",
    value: "cloud",
  };
  const choices = hasCustomEndpoint
    ? [
        {
          title: `Self-hosted instance (${current.url})`,
          description: "Keep using your current endpoint",
          value: "keep",
        },
        {
          title: "Self-hosted instance (different endpoint)",
          description: "Point at another LangWatch deployment",
          value: "self-hosted",
        },
        cloudChoice,
      ]
    : [
        cloudChoice,
        {
          title: "Self-hosted instance",
          description: "Your company's LangWatch deployment (custom URL)",
          value: "self-hosted",
        },
      ];

  const where = await prompts({
    type: "select",
    name: "where",
    message: "Where do you want to log in?",
    choices,
    initial: 0,
  });
  if (!where.where) {
    console.log(chalk.yellow("Login cancelled"));
    process.exit(0);
  }

  const cfg = loadConfig();
  if (where.where === "cloud") {
    // Always repoint to cloud, overriding any stale local control_plane_url.
    // Otherwise the device flow would dial the old localhost host and fail
    // with ECONNREFUSED.
    cfg.control_plane_url = DEFAULT_ENDPOINT;
    saveConfig(cfg);
  } else if (where.where === "keep") {
    cfg.control_plane_url = current.url;
    saveConfig(cfg);
  } else if (where.where === "self-hosted") {
    const url = await prompts({
      type: "text",
      name: "url",
      message: "Self-hosted LangWatch URL (e.g. https://lw.acme.internal):",
      validate: validateEndpointUrl,
    });
    if (!url.url) {
      console.log(chalk.yellow("Login cancelled"));
      process.exit(0);
    }
    cfg.control_plane_url = normalizeEndpoint(url.url as string);
    saveConfig(cfg);
  }
  warnIfLocalEndpointTakesOverGlobalConfig(cfg.control_plane_url);
}

export const loginCommand = async (options?: {
  apiKey?: string;
  device?: boolean;
  project?: boolean | string;
  browser?: string;
  endpoint?: string;
  token?: string;
  manageTeams?: boolean;
}): Promise<void> => {
  try {
    // Team management rides on the device login key only: a project key or
    // a pre-minted token never passes through the approval that grants it.
    if (options?.manageTeams && (options.project || options.apiKey || options.token)) {
      console.error(
        chalk.red(
          "Error: --manage-teams applies to the device login. Run `langwatch login --device --manage-teams`.",
        ),
      );
      process.exit(1);
    }

    // First, so every flow below reads a config that already says how to run
    // this CLI; the Claude Code plugin's hooks look it up there.
    recordCliLocation();

    // Honor `--endpoint`/`LANGWATCH_ENDPOINT`, persisted before the chosen flow
    // runs so every subsequent read (device flow, API-key flow, spawned
    // sub-commands) sees it — the env var becomes the picker's default choice,
    // so `LANGWATCH_ENDPOINT=... langwatch login` is one Enter, not a retyped URL.
    persistPresetEndpoint(options?.endpoint);

    // --token: pre-minted device-session escape hatch (CI / agent contexts
    // where the token was minted via the dashboard 'Personal Access Tokens'
    // surface). No browser, no prompts — just persist the token so
    // subsequent `langwatch claude/codex/...` invocations can use it.
    if (options?.token) {
      saveDeviceSessionToken(options.token);
      return;
    }

    // Device-flow mode: SSO via the control plane's RFC 8628 endpoints,
    // mints a personal virtual key bound to the user. This is the
    // governance-plane onboarding for enterprise users, distinct from the
    // single-user API-key flow below.
    if (options?.device || options?.manageTeams) {
      await runDeviceFlowLogin({
        browser: options.browser,
        teamManagement: options.manageTeams === true,
      });
      return;
    }

    // --project: force PROJECT login, symmetric to --device. With a slug,
    // the key resolves through the device session with no browser (headless
    // path); without one, a non-TTY terminal fails fast instead of blocking.
    if (typeof options?.project === "string") {
      await loginToProjectBySlug(options.project);
      return;
    }
    if (options?.project) {
      if (!process.stdin.isTTY) {
        failFastHeadlessProjectLogin();
      }
      await runUnifiedLoginFlow({
        kind: "project_api_key",
        browser: options.browser,
      });
      return;
    }

    // Non-interactive mode: --api-key flag provided
    if (options?.apiKey) {
      saveApiKeyFlag(options.apiKey);
      return;
    }

    // Interactive mode, non-TTY (CI, agent piped stdin): default to PROJECT
    // login, writing a real project's key to `.env` as the SDK and skills
    // expect. AI-tools login stays explicit behind `--device` now, which
    // used to be the nudge here and silently routed evals to a personal project.
    if (!process.stdin.isTTY) {
      console.log(
        chalk.gray(
          "No login mode given. Defaulting to project login (writes LANGWATCH_API_KEY to .env). Force it with --project.",
        ),
      );
      console.log(
        chalk.gray(
          "For AI-tools login (claude, codex, gemini, opencode), re-run: langwatch login --device",
        ),
      );
      console.log();
      failFastHeadlessProjectLogin();
    }

    // Always-on agent-hint banner — fake-TTY agents see this BEFORE the
    // prompt block so they (or the human watching) can re-invoke with the
    // right flag instead of staring at a stuck prompt.
    printAgentHintBanner();

    console.log(chalk.blue("🔐 LangWatch Login"));
    console.log();

    // Q1 -- endpoint (cloud vs self-hosted), skipped if --endpoint was
    // passed. Persisted to ~/.langwatch/config.json on every branch so the
    // login call and every later resolver target the right host.
    if (!options?.endpoint) await chooseEndpoint();

    // Q2 — auth mode (AI tools = device-flow vs Project SDK = API key)
    const mode = await prompts({
      type: "select",
      name: "mode",
      message: "How do you want to use LangWatch?",
      choices: [
        {
          title: "AI tools / agentic flows",
          description: "claude, codex, cursor, gemini, opencode - device-flow SSO",
          value: "device",
        },
        {
          title: "Project / SDK API key",
          description: "langwatch eval, sync, prompts, SDK auto-instrumentation - writes .env",
          value: "api-key",
        },
        {
          title: "Both",
          description: "Run both flows in sequence",
          value: "both",
        },
      ],
      initial: 0,
    });
    if (!mode.mode) {
      console.log(chalk.yellow("Login cancelled"));
      process.exit(0);
    }

    if (mode.mode === "device" || mode.mode === "both") {
      await runDeviceFlowLogin({ browser: options?.browser });
    }
    if (mode.mode === "api-key" || mode.mode === "both") {
      // The browser page shows a project picker; approving sends that
      // project's existing API key back to the CLI over the same RFC 8628
      // poll endpoint as the device-session flow. No copy-paste of the
      // credential ever.
      await runUnifiedLoginFlow({
        kind: "project_api_key",
        browser: options?.browser,
      });
    }
    return;
  } catch (error) {
    console.error(chalk.red(`Error during login: ${formatApiErrorMessage({ error })}`));
    process.exit(1);
  }
};
