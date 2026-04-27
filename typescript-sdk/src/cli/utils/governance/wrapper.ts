/**
 * exec wrapper helper for `langwatch claude` / `codex` / `cursor` /
 * `gemini`. Loads the persisted device-flow config, optionally
 * pre-checks the budget (Screen-8 box + exit 2 if exceeded),
 * computes the right env-var pair for the tool, and spawns the
 * underlying binary inheriting stdio so the user keeps their
 * familiar UX.
 *
 * On Unix we use spawn() with stdio:'inherit'; signals (Ctrl-C,
 * SIGTERM) propagate via the child process group. We do NOT use
 * execve replacement — Node's child_process never replaces the
 * current process, but this is functionally equivalent for the
 * end-user (same exit code, same terminal handling) and works on
 * Windows where execve doesn't exist.
 */

import { spawn } from "node:child_process";
import {
  GovernanceConfig,
  loadConfig,
  saveConfig,
  isLoggedIn,
} from "./config";
import { checkBudget, renderBudgetExceeded } from "./budget";

export interface ToolEnv {
  /** Env-var name → value pairs to inject into the child process. */
  vars: Record<string, string>;
}

/**
 * Mirror of the Go CLI's env-injection map. The wrapped tools
 * read these standard env vars (Anthropic, OpenAI, Google) and
 * route through the gateway with the user's personal VK as bearer.
 */
export function envForTool(cfg: GovernanceConfig, tool: string): ToolEnv {
  const gw = cfg.gateway_url.replace(/\/+$/, "");
  const auth = cfg.default_personal_vk?.secret;
  if (!auth) return { vars: {} };
  switch (tool) {
    case "claude":
      return {
        vars: {
          ANTHROPIC_BASE_URL: `${gw}/api/v1/anthropic`,
          ANTHROPIC_AUTH_TOKEN: auth,
        },
      };
    case "codex":
      return {
        vars: {
          OPENAI_BASE_URL: `${gw}/api/v1/openai`,
          OPENAI_API_KEY: auth,
        },
      };
    case "cursor":
      return {
        vars: {
          OPENAI_BASE_URL: `${gw}/api/v1/openai`,
          OPENAI_API_KEY: auth,
          ANTHROPIC_BASE_URL: `${gw}/api/v1/anthropic`,
          ANTHROPIC_AUTH_TOKEN: auth,
        },
      };
    case "gemini":
      return {
        vars: {
          GOOGLE_GENAI_API_BASE: `${gw}/api/v1/gemini`,
          GEMINI_API_KEY: auth,
        },
      };
    default:
      return { vars: {} };
  }
}

/**
 * Run the named tool routed through the gateway. Inherits stdio so
 * the user gets the same interactive UX they'd have invoking the
 * tool directly. Exits the parent process with the child's exit
 * code (or 2 if the budget pre-check fired).
 */
export async function runWrapped(tool: string, args: string[]): Promise<never> {
  const cfg = loadConfig();
  if (!isLoggedIn(cfg)) {
    process.stderr.write("Not logged in — run `langwatch login --device` first\n");
    process.exit(1);
  }

  // Budget pre-check — render Screen-8 box + exit 2 BEFORE exec.
  const exceeded = await checkBudget(cfg);
  if (exceeded) {
    process.stderr.write(renderBudgetExceeded(exceeded));
    if (exceeded.request_increase_url) {
      cfg.last_request_increase_url = exceeded.request_increase_url;
      try {
        saveConfig(cfg);
      } catch {
        // Config write failure shouldn't change the spec'd exit
        // code — the next `langwatch request-increase` falls back
        // to the static page.
      }
    }
    process.exit(2);
  }

  const env = { ...process.env, ...envForTool(cfg, tool).vars };
  // npm installs claude/codex/cursor/gemini as `.cmd` shims on Windows;
  // bare spawn() can't resolve them without a shell. shell:true is safe
  // here because `tool` is whitelisted (claude/codex/cursor/gemini) and
  // `args` is forwarded from the user's own terminal invocation — same
  // trust boundary as if they'd typed `claude …` directly.
  const child = spawn(tool, args, {
    stdio: "inherit",
    env,
    shell: process.platform === "win32",
  });
  child.on("error", (err) => {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      process.stderr.write(
        `${tool} not found in PATH — install it first (https://docs.langwatch.ai/ai-gateway/governance/admin-setup#cli-device-flow-rest-api)\n`,
      );
      process.exit(127);
    }
    process.stderr.write(`exec ${tool}: ${err.message}\n`);
    process.exit(1);
  });
  await new Promise<void>((resolve) => {
    child.on("close", (code) => {
      process.exit(code ?? 1);
      resolve();
    });
  });
  // unreachable
  process.exit(0);
}
