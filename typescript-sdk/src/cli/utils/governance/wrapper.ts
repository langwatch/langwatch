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
import type { GovernanceConfig } from "./config";
import { loadConfig, saveConfig, isLoggedIn } from "./config";
import { checkBudget, renderBudgetExceeded } from "./budget";
import {
  getCliBootstrap,
  installUserIngestionBinding,
  listIngestionTemplates,
  listUserIngestionBindings,
  rotateUserIngestionBindingToken,
} from "./cli-api";
import { runDeviceFlowLogin } from "./login-flow";

/** Templates we auto-mint a personal ingestion binding for, per wrapped tool. */
const TOOL_INGESTION_TEMPLATE_SLUG: Record<string, string> = {
  claude: "claude_code",
};

export interface ToolEnv {
  /** Env-var name → value pairs to inject into the child process. */
  vars: Record<string, string>;
}

/**
 * Standard OTEL_*_EXPORTER + endpoint + headers triple for the
 * wrapped tool. Tools that natively read OTEL env vars (Claude
 * Code, opencode, ...) emit their logs/metrics/spans to
 * `<control_plane>/api/otel` alongside the normal API traffic. The
 * gateway routes the API calls (via the provider env above), AND
 * we also get the in-process OTLP signal — both data shapes, one
 * CLI command.
 *
 * `serviceName` lands in OTEL_RESOURCE_ATTRIBUTES so the recorded
 * traces surface under a human-readable name in /messages. `extras`
 * lets a tool pass tool-specific gate envs (eg. claude-code
 * requires `CLAUDE_CODE_ENABLE_TELEMETRY=1`).
 */
function envForToolOtel(
  serviceName: string,
  controlPlaneBase: string,
  ingestionToken: string,
  extras: Record<string, string> = {},
): Record<string, string> {
  const cp = controlPlaneBase.replace(/\/+$/, "");
  return {
    OTEL_TRACES_EXPORTER: "otlp",
    OTEL_LOGS_EXPORTER: "otlp",
    OTEL_METRICS_EXPORTER: "otlp",
    OTEL_EXPORTER_OTLP_PROTOCOL: "http/json",
    OTEL_EXPORTER_OTLP_ENDPOINT: `${cp}/api/otel`,
    OTEL_EXPORTER_OTLP_HEADERS: `Authorization=Bearer ${ingestionToken}`,
    OTEL_RESOURCE_ATTRIBUTES: `service.name=${serviceName}`,
    ...extras,
  };
}

/**
 * Mirror of the Go CLI's env-injection map. The wrapped tools
 * read these standard env vars (Anthropic, OpenAI, Google) and
 * route through the gateway with the user's personal VK as bearer.
 *
 * For `claude`, when `cfg.default_personal_ingestion_token` is
 * present, we ALSO inject the OTEL_* triple so Claude Code emits
 * OTLP telemetry to `<control_plane>/api/otel`. Both paths in one
 * invocation, no admin toggle.
 */
export function envForTool(cfg: GovernanceConfig, tool: string): ToolEnv {
  const gw = cfg.gateway_url.replace(/\/+$/, "");
  const auth = cfg.default_personal_vk?.secret;
  const ik = cfg.default_personal_ingestion_token?.secret;
  if (!auth) return { vars: {} };
  switch (tool) {
    case "claude":
      return {
        vars: {
          ANTHROPIC_BASE_URL: gw,
          ANTHROPIC_AUTH_TOKEN: auth,
          ...(ik
            ? envForToolOtel("claude-code", cfg.control_plane_url, ik, {
                CLAUDE_CODE_ENABLE_TELEMETRY: "1",
              })
            : {}),
        },
      };
    case "codex":
      // codex 0.x has no native telemetry-enable env yet; the
      // OTEL_* vars are harmless if it ignores them but pick up
      // once codex adds support, no rev-bump on our side.
      return {
        vars: {
          OPENAI_BASE_URL: gw,
          OPENAI_API_KEY: auth,
          ...(ik ? envForToolOtel("codex", cfg.control_plane_url, ik) : {}),
        },
      };
    case "cursor":
      return {
        vars: {
          OPENAI_BASE_URL: gw,
          OPENAI_API_KEY: auth,
          ANTHROPIC_BASE_URL: gw,
          ANTHROPIC_AUTH_TOKEN: auth,
        },
      };
    case "gemini":
      return {
        vars: {
          GOOGLE_GENAI_API_BASE: gw,
          GEMINI_API_KEY: auth,
          ...(ik
            ? envForToolOtel("gemini-cli", cfg.control_plane_url, ik, {
                GEMINI_TELEMETRY_ENABLED: "true",
              })
            : {}),
        },
      };
    case "opencode":
      // opencode is multi-provider — it reads the standard
      // OPENAI_*/ANTHROPIC_* env vars depending on which model the
      // user selected at the prompt. Mirror cursor's both-pairs
      // injection so any provider the user hops to lands at our gw.
      // Native OTEL_*_EXPORTER support added when ingestion token is
      // present (no per-tool gate env required; emission is
      // env-only).
      return {
        vars: {
          OPENAI_BASE_URL: gw,
          OPENAI_API_KEY: auth,
          ANTHROPIC_BASE_URL: gw,
          ANTHROPIC_AUTH_TOKEN: auth,
          ...(ik ? envForToolOtel("opencode", cfg.control_plane_url, ik) : {}),
        },
      };
    default:
      return { vars: {} };
  }
}

/**
 * Provider families the tool needs upstream. Used by `preflightWrapper`
 * to verify the org has at least one matching provider configured —
 * otherwise the gateway can authenticate the VK but has nothing to
 * route the request to, surfacing as a confusing tool-side error.
 *
 * Multi-provider tools (cursor, opencode) match any listed family.
 */
const TOOL_PROVIDER_FAMILIES: Record<string, string[]> = {
  claude: ["anthropic"],
  codex: ["openai"],
  cursor: ["anthropic", "openai"],
  gemini: ["google", "gemini"],
  opencode: ["anthropic", "openai"],
};

export interface PreflightResult {
  ok: boolean;
  /** Human-readable, action-oriented message rendered to stderr on failure. */
  message?: string;
}

export interface PreflightOptions {
  fetchImpl?: typeof fetch;
  bootstrapImpl?: typeof getCliBootstrap;
  /** Per-probe timeout, ms. Default 3000. */
  timeoutMs?: number;
}

/**
 * Render the "who to talk to" footer attached to every preflight
 * failure message. Single source of truth so the admin-mailto format
 * stays consistent across the three failure shapes. Bootstrap is the
 * source of `adminEmail`; on legacy servers or unreachable control
 * planes it'll be null and we fall back to a generic line.
 */
function renderContactFooter(adminEmail: string | null | undefined): string {
  if (adminEmail) {
    return `Need help? Contact your LangWatch admin: ${adminEmail}\n`;
  }
  return `If you need help, contact your LangWatch admin.\n`;
}

/**
 * Pre-exec probe for `langwatch <tool>` wrappers. Three layered checks,
 * each gracefully degrading rather than blocking on transient hiccups:
 *
 *   1. `cfg.default_personal_vk?.secret` present — without it the
 *      wrapper would silently inject no env vars and the underlying
 *      tool would call the upstream provider directly (api.anthropic.com
 *      etc.), surfacing as the wrong error or — when there's stale
 *      env from a prior session — a confusing ConnectionRefused
 *      against a stale base URL.
 *   2. `GET <gateway_url>/healthz` reachable. Catches "data plane not
 *      running" and bad `LANGWATCH_GATEWAY_URL` overrides. Fatal: if
 *      the gateway isn't reachable the tool will spin in a retry loop
 *      and there's no recovery. We don't name a specific run command
 *      (`make`, helm chart, docker compose, `npx @langwatch/server`,
 *      etc.) because deployments vary; point the user at the admin
 *      contact instead.
 *   3. `getCliBootstrap()` providers cover the tool's family. Catches
 *      the shape where login succeeds but the org has no AI provider
 *      configured yet, so the gateway has nothing to route to. 404 /
 *      missing-providers data passes through (older self-hosted
 *      servers without the endpoint).
 *
 * Bootstrap is fetched up-front (it lives on the control plane,
 * independent of the gateway data plane) so every failure message can
 * embed the org admin's email as a real contact path. A bootstrap
 * error is non-fatal; we just lose the admin mailto and continue.
 */
export async function preflightWrapper(
  cfg: GovernanceConfig,
  tool: string,
  opts: PreflightOptions = {},
): Promise<PreflightResult> {
  const cp = cfg.control_plane_url.replace(/\/+$/, "");
  const bootstrap = await (opts.bootstrapImpl ?? getCliBootstrap)(cfg).catch(
    () => null,
  );
  const adminEmail = bootstrap?.adminEmail ?? null;

  if (!cfg.default_personal_vk?.secret) {
    return {
      ok: false,
      message:
        `No personal virtual key on this account.\n` +
        `Your organization needs at least one AI provider configured before\n` +
        `\`langwatch ${tool}\` can route requests.\n` +
        `If you're an admin, set one up at\n` +
        `  ${cp}/settings/model-providers\n` +
        `then run \`langwatch login --device\` to refresh your credentials.\n` +
        renderContactFooter(adminEmail),
    };
  }

  const gw = cfg.gateway_url.replace(/\/+$/, "");
  const f = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 3000;
  try {
    const res = await f(`${gw}/healthz`, {
      method: "GET",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      return {
        ok: false,
        message:
          `AI Gateway at ${gw} returned HTTP ${res.status}.\n` +
          `The wrapper cannot route \`langwatch ${tool}\` requests until the\n` +
          `data plane is healthy. Check that the LangWatch gateway is running.\n` +
          renderContactFooter(adminEmail),
      };
    }
  } catch (err) {
    return {
      ok: false,
      message:
        `Cannot reach AI Gateway at ${gw}\n` +
        `  ${(err as Error).message}\n` +
        `Check that the LangWatch gateway is running, or set LANGWATCH_GATEWAY_URL\n` +
        `if you've deployed it elsewhere.\n` +
        renderContactFooter(adminEmail),
    };
  }

  const need = TOOL_PROVIDER_FAMILIES[tool];
  if (
    need &&
    need.length > 0 &&
    bootstrap &&
    Array.isArray(bootstrap.providers)
  ) {
    const have = new Set(bootstrap.providers.map((p) => p.name.toLowerCase()));
    const matches = need.filter((n) => have.has(n));
    if (matches.length === 0) {
      const list = need.map((n) => `\`${n}\``).join(" or ");
      return {
        ok: false,
        message:
          `No ${list} provider is configured for your organization.\n` +
          `\`langwatch ${tool}\` needs at least one to route requests through the gateway.\n` +
          `If you're an admin, configure one at\n` +
          `  ${cp}/settings/model-providers\n` +
          renderContactFooter(adminEmail),
      };
    }
  }

  return { ok: true };
}

/**
 * When the wrapper is invoked without a usable config, decide whether to
 * auto-trigger the device-flow login inline or to fail fast. The device
 * flow needs a TTY (the user has to copy a code or click a browser link),
 * so default ON only when stdin is a TTY. CI/scripted callers can opt in
 * explicitly via `LANGWATCH_AUTO_LOGIN=1`, or opt out via
 * `LANGWATCH_AUTO_LOGIN=0` even on an interactive shell.
 */
function shouldAutoLogin(): boolean {
  const flag = process.env.LANGWATCH_AUTO_LOGIN;
  if (flag === "1" || flag === "true") return true;
  if (flag === "0" || flag === "false") return false;
  return Boolean(process.stdin.isTTY);
}

/**
 * Lazy auto-mint of the personal ingestion binding for the tool's
 * canonical template (e.g. `claude_code` for the claude wrapper).
 * Runs once per machine: the resulting token is cached at
 * `cfg.default_personal_ingestion_token` and reused on every
 * subsequent wrapper invocation. If the user already has the
 * binding but we lost the secret (eg. fresh worktree, config wipe),
 * we rotate to get a fresh token.
 *
 * Failures are non-fatal — the wrapper falls back to gateway-only
 * env injection (existing behavior). The tool still runs; we just
 * lose the OTLP telemetry side.
 */
async function ensureIngestionToken(
  cfg: GovernanceConfig,
  tool: string,
): Promise<GovernanceConfig> {
  if (cfg.default_personal_ingestion_token?.secret) return cfg;
  const targetSlug = TOOL_INGESTION_TEMPLATE_SLUG[tool];
  if (!targetSlug) return cfg;

  try {
    const templates = await listIngestionTemplates(cfg);
    const target = templates.find((t) => t.slug === targetSlug && t.enabled);
    if (!target) return cfg;

    const bindings = await listUserIngestionBindings(cfg);
    const existing = bindings.find((b) => b.template_id === target.id);

    let result;
    if (existing) {
      // Rotate to recover a fresh secret — the original is stored
      // only at install time + shown once. Lossless from the user's
      // perspective since the wrapper is the sole consumer.
      result = await rotateUserIngestionBindingToken(cfg, existing.id);
    } else {
      result = await installUserIngestionBinding(cfg, target.id);
    }

    cfg.default_personal_ingestion_token = {
      id: result.user_ingestion_binding.id,
      secret: result.binding_access_token,
      prefix: result.user_ingestion_binding.binding_access_token_prefix,
    };
    try {
      saveConfig(cfg);
    } catch {
      // Persist failure doesn't break this run — env vars already
      // built off the in-memory cfg below.
    }
  } catch {
    // Network / 4xx / disabled-template all fall back to
    // gateway-only env injection.
  }
  return cfg;
}

/**
 * Run the named tool routed through the gateway. Inherits stdio so
 * the user gets the same interactive UX they'd have invoking the
 * tool directly. Exits the parent process with the child's exit
 * code (or 2 if the budget pre-check fired).
 */
export async function runWrapped(tool: string, args: string[]): Promise<never> {
  let cfg = loadConfig();
  if (!isLoggedIn(cfg)) {
    if (!shouldAutoLogin()) {
      process.stderr.write(
        "Not logged in. Run `langwatch login --device` first.\n",
      );
      process.exit(1);
    }
    process.stderr.write(
      "Not logged in. Starting device-flow login...\n",
    );
    try {
      cfg = await runDeviceFlowLogin({ cfg });
    } catch (err) {
      process.stderr.write(
        `login failed: ${(err as Error).message ?? "unknown error"}\n`,
      );
      process.exit(1);
    }
    if (!isLoggedIn(cfg)) {
      process.stderr.write("login did not complete — exiting\n");
      process.exit(1);
    }
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

  const probe = await preflightWrapper(cfg, tool);
  if (!probe.ok) {
    process.stderr.write(probe.message ?? "preflight failed\n");
    process.exit(2);
  }

  cfg = await ensureIngestionToken(cfg, tool);

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
