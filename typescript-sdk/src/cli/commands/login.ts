import * as fs from "fs";
import * as path from "path";
import chalk from "chalk";
import prompts from "prompts";
import { formatApiErrorMessage } from "@/client-sdk/services/_shared/format-api-error";
import {
  runDeviceFlowLogin,
  runUnifiedLoginFlow,
} from "@/cli/utils/governance/login-flow";
import {
  loadConfig,
  saveConfig,
} from "@/cli/utils/governance/config";

/**
 * Always-on agent-hint banner shown above the interactive prompts on
 * `langwatch login` (no flags). Some agent harnesses fake a TTY but can't
 * actually answer prompts — this banner names the escape-hatch flags so
 * the agent (or the human staring at the stuck prompt) can re-invoke
 * with the right flag and proceed.
 *
 * Spec: specs/ai-governance/cli-onboarding/login-unified.feature
 */
function printAgentHintBanner(): void {
  console.log(
    chalk.gray(
      "Running interactively. To skip these prompts (CI / agents that already have a credential):",
    ),
  );
  console.log(
    chalk.gray(
      "  --api-key <KEY>            project SDK key into .env (default — SDK, evals, prompts)",
    ),
  );
  console.log(
    chalk.gray(
      "  --device                   AI tools / SSO (claude, codex, gemini, opencode)",
    ),
  );
  console.log(
    chalk.gray(
      "  --token <TOKEN>            pre-minted device session (writes ~/.langwatch/config.json)",
    ),
  );
  console.log(
    chalk.gray(
      "  --endpoint <URL>           self-hosted instance URL",
    ),
  );
  console.log();
}

const updateEnvFile = (
  apiKey: string,
): { created: boolean; updated: boolean; path: string } => {
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

export const loginCommand = async (
  options?: {
    apiKey?: string;
    device?: boolean;
    browser?: string;
    endpoint?: string;
    token?: string;
  },
): Promise<void> => {
  try {
    // Honor `--endpoint` flag OR `LANGWATCH_ENDPOINT` env. Persist the
    // resolved value BEFORE the chosen flow runs so subsequent reads
    // (in the device flow, the API-key flow, any sub-command spawned
    // later) see the right control-plane URL. The 4-source resolver
    // (flag > env > config > default) honors this value via the
    // persisted-config layer for any flow that doesn't explicitly take
    // a flag. The env var has the same precedence as the flag for the
    // login flow itself so users running `LANGWATCH_ENDPOINT=... langwatch
    // login` skip the cloud/self-hosted picker.
    const endpointFromEnv = process.env.LANGWATCH_ENDPOINT?.trim();
    const presetEndpoint = options?.endpoint ?? endpointFromEnv;
    if (presetEndpoint) {
      const trimmed = presetEndpoint.replace(/\/+$/, "");
      const cfg = loadConfig();
      cfg.control_plane_url = trimmed;
      saveConfig(cfg);
    }

    // --token: pre-minted device-session escape hatch (CI / agent contexts
    // where the token was minted via the dashboard 'Personal Access Tokens'
    // surface). No browser, no prompts — just persist the token so
    // subsequent `langwatch claude/codex/...` invocations can use it.
    if (options?.token) {
      const token = options.token.trim();
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
      return;
    }

    // Device-flow mode: SSO via the control plane's RFC 8628 endpoints,
    // mints a personal virtual key bound to the user. This is the
    // governance-plane onboarding for enterprise users, distinct from the
    // single-user API-key flow below.
    if (options?.device) {
      await runDeviceFlowLogin({ browser: options.browser });
      return;
    }

    // Non-interactive mode: --api-key flag provided
    if (options?.apiKey) {
      const apiKey = options.apiKey.trim();
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
      return;
    }

    // Interactive mode (no flags). On a non-TTY context (CI, an agent's
    // piped stdin) we cannot prompt. Erroring here used to nudge agents
    // toward `--device`, which signs them into a personal device-session and
    // silently routed their evaluations to a personal project. Default to
    // PROJECT login instead: it writes a real project's key to `.env`, which
    // is what the SDK, `langwatch eval`, and the skills expect. AI-tools
    // login stays explicit behind `--device`.
    if (!process.stdin.isTTY) {
      console.log(
        chalk.gray(
          "No login mode given — defaulting to project login (writes LANGWATCH_API_KEY to .env).",
        ),
      );
      console.log(
        chalk.gray(
          "For AI-tools login (claude, codex, gemini, opencode), re-run: langwatch login --device",
        ),
      );
      console.log();
      await runUnifiedLoginFlow({
        kind: "project_api_key",
        browser: options?.browser,
      });
      return;
    }

    // Always-on agent-hint banner — fake-TTY agents see this BEFORE the
    // prompt block so they (or the human watching) can re-invoke with the
    // right flag instead of staring at a stuck prompt.
    printAgentHintBanner();

    console.log(chalk.blue("🔐 LangWatch Login"));
    console.log();

    // Q1 — endpoint (cloud vs self-hosted). Skipped if --endpoint was
    // passed (already persisted above). On 'self-hosted' the entered
    // URL is persisted to ~/.langwatch/config.json so subsequent
    // `runUnifiedLoginFlow` calls (and every CLI command's resolver
    // read) target the right host.
    if (!options?.endpoint) {
      const where = await prompts({
        type: "select",
        name: "where",
        message: "Where do you want to log in?",
        choices: [
          {
            title: "LangWatch Cloud",
            description: "app.langwatch.ai (default)",
            value: "cloud",
          },
          {
            title: "Self-hosted instance",
            description: "Custom URL — your company's LangWatch deployment",
            value: "self-hosted",
          },
        ],
        initial: 0,
      });
      if (where.where === "self-hosted") {
        const url = await prompts({
          type: "text",
          name: "url",
          message: "Self-hosted LangWatch URL (e.g. https://lw.acme.internal):",
          validate: (v: string) => {
            try {
              const parsed = new URL(v);
              if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
                return "URL must start with http(s)://";
              }
              return true;
            } catch {
              return "URL must be absolute (https://...)";
            }
          },
        });
        if (!url.url) {
          console.log(chalk.yellow("Login cancelled"));
          process.exit(0);
        }
        const cfg = loadConfig();
        cfg.control_plane_url = (url.url as string).replace(/\/+$/, "");
        saveConfig(cfg);
      }
    }

    // Q2 — auth mode (AI tools = device-flow vs Project SDK = API key)
    const mode = await prompts({
      type: "select",
      name: "mode",
      message: "How do you want to use LangWatch?",
      choices: [
        {
          title: "Project / SDK API key",
          description: "langwatch eval, sync, prompts, SDK auto-instrumentation — writes .env",
          value: "api-key",
        },
        {
          title: "AI tools / agentic flows",
          description: "claude, codex, cursor, gemini, opencode — device-flow SSO",
          value: "device",
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
      // No-paste convergence (sergey f9fcc3927 + alexis bfef4ebab):
      // /authorize page shows a project-picker + 'Generate API key'
      // button; the freshly-minted key flows back to the CLI over the
      // same RFC 8628 poll endpoint as the device-session flow. No
      // copy-paste of the credential ever.
      await runUnifiedLoginFlow({
        kind: "project_api_key",
        browser: options?.browser,
      });
    }
    return;
  } catch (error) {
    console.error(
      chalk.red(
        `Error during login: ${
          formatApiErrorMessage({ error })
        }`,
      ),
    );
    process.exit(1);
  }
};


