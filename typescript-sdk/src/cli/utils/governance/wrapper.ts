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
 * execve replacement - Node's child_process never replaces the
 * current process, but this is functionally equivalent for the
 * end-user (same exit code, same terminal handling) and works on
 * Windows where execve doesn't exist.
 */

import { spawn } from "node:child_process";
import type { GovernanceConfig } from "./config";
import { loadConfig, saveConfig, isLoggedIn } from "./config";
import { lwTag } from "./brand";
import { checkBudget, renderBudgetExceeded } from "./budget";
import { getCliBootstrap, GovernanceCliError } from "./cli-api";
import { runDeviceFlowLogin } from "./login-flow";
import { resolvePlatformToolPolicy } from "./platform-tool-policy";
import { maybeOfferIngestionShellRcPersist } from "./shell-rc";
import { resolveWrapperMode } from "./wrapper-mode";
import { parseToolModeFlag, resolveWrapperPath } from "./wrapper-path-choice";

export interface ToolEnv {
  /** Env-var name → value pairs to inject into the child process. */
  vars: Record<string, string>;
  /**
   * Env-var names to STRIP from the inherited parent environment
   * before spawning the tool. Used to scrub legacy credentials the
   * user has exported in their shell (e.g. ANTHROPIC_API_KEY set
   * from a previous direct-Anthropic workflow) that would otherwise
   * race with the gateway-routed auth (ANTHROPIC_AUTH_TOKEN) we
   * inject - claude-code 2.x detects both and warns
   * "auth may not work as expected", so we have to actively unset
   * the conflicting twin rather than just pile on top of it.
   * Unset BEFORE the merge so a tool that intentionally sets both
   * (opencode for provider auto-detect) still wins.
   */
  clears?: string[];
}

/**
 * Mirror of the Go CLI's env-injection map. The wrapped tools
 * read these standard env vars (Anthropic, OpenAI, Google) and
 * route through the gateway with the user's personal VK as bearer.
 *
 * Gateway-only on purpose: when the VK is on the API path the
 * gateway already captures every request + response server-side
 * (full I/O, exact cost). Injecting OTEL_* on top would make the
 * wrapped tool emit its own telemetry for the SAME calls = double
 * trace + double cost in /messages. The OTLP ingest path is for
 * users who can't go through the gateway at all (Claude Max
 * subscription, no swappable API key); they paste the OTEL env
 * block from the /me drawer manually. See
 * docs/ai-governance/track-your-claude-code-usage.mdx (Path A vs
 * Path B).
 */
export function envForTool(cfg: GovernanceConfig, tool: string): ToolEnv {
  const gw = cfg.gateway_url.replace(/\/+$/, "");
  const auth = cfg.default_personal_vk?.secret;
  if (!auth) return { vars: {} };
  switch (tool) {
    case "claude":
      // claude-code (2.1.x) appends `/v1/messages` to ANTHROPIC_BASE_URL itself.
      // Clear the legacy ANTHROPIC_API_KEY twin: claude-code warns
      // "Both ANTHROPIC_AUTH_TOKEN and ANTHROPIC_API_KEY set, auth may
      // not work as expected" when both are present (the gateway route
      // uses AUTH_TOKEN; API_KEY is left over from pre-langwatch direct
      // SDK usage). Stripping it leaves only the gateway-routed creds
      // on the child env.
      return {
        vars: {
          ANTHROPIC_BASE_URL: gw,
          ANTHROPIC_AUTH_TOKEN: auth,
        },
        clears: ["ANTHROPIC_API_KEY"],
      };
    case "codex":
      // codex 0.134 appends `/v1/chat/completions` itself.
      return {
        vars: {
          OPENAI_BASE_URL: gw,
          OPENAI_API_KEY: auth,
        },
      };
    case "cursor":
      // Same warning surface as claude: Anthropic SDKs nested in
      // cursor's runtime will read ANTHROPIC_API_KEY in preference to
      // ANTHROPIC_AUTH_TOKEN if both are set, bypassing the gateway.
      // Scrub the legacy key.
      return {
        vars: {
          OPENAI_BASE_URL: gw,
          OPENAI_API_KEY: auth,
          ANTHROPIC_BASE_URL: gw,
          ANTHROPIC_AUTH_TOKEN: auth,
        },
        clears: ["ANTHROPIC_API_KEY"],
      };
    case "gemini":
      // gemini-cli 0.46-preview honours `GOOGLE_GEMINI_BASE_URL`
      // (verified empirically in the bundled binary). It POSTs to
      // `{BASE}/v1beta/models/{model}:generateContent`, prepending
      // the `/v1beta/` itself. The base must therefore be the bare
      // gateway URL without the API version suffix; an earlier guess
      // of `${gw}/v1beta` doubled the prefix to `/v1beta/v1beta/` and
      // the gateway 404'd the routing call, surfacing as
      // "Unexpected end of JSON input" on the cli side.
      // `GOOGLE_GENAI_API_BASE` is NOT read by gemini-cli (separate
      // guess that silently no-op'd in earlier wrapper revisions).
      return {
        vars: {
          GOOGLE_GEMINI_BASE_URL: gw,
          GEMINI_API_KEY: auth,
          GOOGLE_API_KEY: auth,
        },
      };
    case "opencode":
      // opencode 1.x is multi-provider; under the hood it uses the
      // Vercel AI SDK, which appends `/messages` and `/chat/completions`
      // to the configured base URL WITHOUT prepending `/v1`. So opencode
      // needs the base to ALREADY include `/v1`, unlike claude-code +
      // codex which append it themselves. Verified via `--log-level
      // DEBUG` - opencode hit `${ANTHROPIC_BASE_URL}/messages` and
      // got a gateway 404 because the gateway exposes `/v1/messages`.
      //
      // Also: opencode's provider auto-detection at init time gates on
      // ANTHROPIC_API_KEY (NOT ANTHROPIC_AUTH_TOKEN, which claude-code
      // uses). Without it, opencode logs `providerID=openai found` /
      // `providerID=opencode found` but NOT anthropic, then fails any
      // `--model anthropic/...` invocation with ProviderModelNotFoundError.
      // Set both so anthropic is detected AND the gateway gets the VK on
      // the wire (the AI SDK forwards x-api-key from ANTHROPIC_API_KEY).
      return {
        vars: {
          OPENAI_BASE_URL: `${gw}/v1`,
          OPENAI_API_KEY: auth,
          ANTHROPIC_BASE_URL: `${gw}/v1`,
          ANTHROPIC_AUTH_TOKEN: auth,
          ANTHROPIC_API_KEY: auth,
        },
      };
    default:
      return { vars: {} };
  }
}

/**
 * Provider families the tool needs upstream. Used by `preflightWrapper`
 * to verify the org has at least one matching provider configured -
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
 *   1. `cfg.default_personal_vk?.secret` present - without it the
 *      wrapper would silently inject no env vars and the underlying
 *      tool would call the upstream provider directly (api.anthropic.com
 *      etc.), surfacing as the wrong error or - when there's stale
 *      env from a prior session - a confusing ConnectionRefused
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
      process.stderr.write("login did not complete - exiting\n");
      process.exit(1);
    }
  }

  // Budget pre-check - render Screen-8 box + exit 2 BEFORE exec.
  const exceeded = await checkBudget(cfg);
  if (exceeded) {
    process.stderr.write(renderBudgetExceeded(exceeded));
    if (exceeded.request_increase_url) {
      cfg.last_request_increase_url = exceeded.request_increase_url;
      try {
        saveConfig(cfg);
      } catch {
        // Config write failure shouldn't change the spec'd exit
        // code - the next `langwatch request-increase` falls back
        // to the static page.
      }
    }
    process.exit(2);
  }

  // Strip the wrapper-only `--tool-mode` flag from the args BEFORE anything
  // forwards them to the real tool, and resolve any explicit override.
  // Everything else stays verbatim + in order for the child invocation.
  const { args: toolArgs, override: pathOverride } = parseToolModeFlag(args);

  // Decide Path A (gateway) vs Path B (ingestion) for this run. Prompts
  // (and remembers the answer) only when the org policy allows BOTH paths,
  // stdin/stdout is a TTY, and there's no pinned preference / override.
  // Runs BEFORE env injection + spawn so the prompt owns stdin.
  let pathChoice;
  try {
    pathChoice = await resolveWrapperPath({
      cfg,
      tool,
      args: toolArgs,
      override: pathOverride,
      // Re-check the org policy at run time so a path the admin disabled
      // after login is respected without a re-login. Best-effort: on any
      // failure resolveWrapperPath keeps the login-cached policy map.
      refreshPolicies: (c) =>
        getCliBootstrap(c).then((b) => b?.toolPolicies ?? null),
    });
  } catch (err) {
    process.stderr.write(`path selection failed: ${(err as Error).message}\n`);
    process.exit(2);
  }

  const toolEnv = envForTool(cfg, tool);
  const gatewayVars = toolEnv.vars;
  const gatewayClears = toolEnv.clears ?? [];
  let modeResult;
  try {
    modeResult = await resolveWrapperMode(
      cfg,
      tool,
      gatewayVars,
      gatewayClears,
      pathChoice.mode,
    );
  } catch (err) {
    // Path B (ingestion) setup can fail at mint time - e.g. the user has
    // no personal workspace yet, or the control plane is unreachable. If
    // the gateway path is allowed for this tool, surface a clear message
    // and fall back to it rather than dead-ending. The both-paths-off
    // `tool_disabled` policy error is NOT a mint failure, so it never
    // falls back; it exits with the admin hint.
    const isToolDisabled =
      err instanceof GovernanceCliError && err.code === "tool_disabled";
    const policy = resolvePlatformToolPolicy(tool, cfg.tool_policies);
    if (pathChoice.mode === "ingestion" && policy.allowVk && !isToolDisabled) {
      process.stderr.write(
        `${lwTag()} couldn't set up direct OTLP ingestion for ${tool} ` +
          `(${(err as Error).message}). Falling back to the gateway path.\n`,
      );
      try {
        modeResult = await resolveWrapperMode(
          cfg,
          tool,
          gatewayVars,
          gatewayClears,
          "gateway",
        );
      } catch (err2) {
        process.stderr.write(
          `mode resolution failed: ${(err2 as Error).message}\n`,
        );
        process.exit(2);
      }
    } else {
      process.stderr.write(
        `mode resolution failed: ${(err as Error).message}\n`,
      );
      process.exit(2);
    }
  }

  // Surface any platform-policy path change (e.g. the org admin turned
  // direct OTLP off for this tool, so the wrapper routed through the
  // gateway instead) so the member sees why the path differs.
  if (modeResult.notice) {
    process.stderr.write(`${modeResult.notice}\n`);
  }

  if (modeResult.mode === "gateway") {
    const probe = await preflightWrapper(cfg, tool);
    if (!probe.ok) {
      process.stderr.write(probe.message ?? "preflight failed\n");
      process.exit(2);
    }
    if (modeResult.codexConfigPath) {
      process.stderr.write(
        `${lwTag()} wired [model_providers.langwatch] in ${modeResult.codexConfigPath}.\n`,
      );
    }
    if (modeResult.codexProfilePath) {
      process.stderr.write(
        `${lwTag()} wrote profile body to ${modeResult.codexProfilePath}.\n`,
      );
    }
  } else {
    // ingestion mode side-effect feedback so the user sees what
    // the wrapper just did on their behalf.
    if (modeResult.newKeyMinted) {
      process.stderr.write(
        `${lwTag()} minted a personal ingestion key for ${tool}.\n`,
      );
    }
    if (modeResult.codexConfigPath) {
      process.stderr.write(
        `${lwTag()} wrote [otel] activation block to ${modeResult.codexConfigPath}.\n`,
      );
    }

    // Path B only: offer to persist the OTLP telemetry exports so a future
    // plain `<tool>` (without the langwatch wrapper) captures
    // automatically. Gated on ingestion mode + opt-out remembered. Runs
    // BEFORE spawn so the prompt still owns stdin.
    await maybeOfferIngestionShellRcPersist({
      cfg,
      tool,
      vars: modeResult.vars,
    });
  }

  // Scrub conflicting twins from the inherited parent env BEFORE merging
  // our vars in. The clears list per tool exists because legacy creds
  // exported in the user's shell (e.g. ANTHROPIC_API_KEY from direct
  // Anthropic SDK usage) would otherwise race with the gateway-routed
  // ANTHROPIC_AUTH_TOKEN we set, surfacing as the claude-code warning
  // "Both ANTHROPIC_AUTH_TOKEN and ANTHROPIC_API_KEY set, auth may not
  // work as expected" and, worse, occasionally letting the SDK pick the
  // wrong credential.
  const parentEnv = { ...process.env };
  for (const key of modeResult.clears ?? []) {
    delete parentEnv[key];
  }
  const env = { ...parentEnv, ...modeResult.vars };
  // Forward the user's args verbatim and in order, minus the stripped
  // wrapper flag (`--tool-mode`). Any mode-specific prepends (e.g. codex
  // `--profile langwatch-gateway`) lead.
  const finalArgs = [...(modeResult.extraArgs ?? []), ...toolArgs];

  // Resolve the tool the way the user's own shell would: route it through
  // their interactive login shell (zsh/bash) so aliases AND functions are
  // honored - e.g. `alias claude='claude --dangerously-skip-permissions'`,
  // not just the bare PATH binary. `-i` sources the rc file where aliases
  // live; the wrapper's env (mode vars + clears) is re-applied *after* that
  // so a user's rc can't clobber the gateway / OTLP wiring. Args ride
  // positional params ("$@") and are never re-quoted. `tool` is whitelisted
  // (claude/codex/cursor/gemini/opencode) so the command string is safe.
  const shellName = (process.env.SHELL ?? "").split("/").pop() ?? "";
  const aliasShell =
    process.platform !== "win32" && (shellName === "zsh" || shellName === "bash")
      ? process.env.SHELL!
      : null;

  const notFoundMessage = `${tool} not found in PATH - install it first (https://docs.langwatch.ai/ai-gateway/governance/admin-setup#cli-device-flow-rest-api)`;

  let child;
  if (aliasShell) {
    const q = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
    const reapply = [
      ...(modeResult.clears ?? []).map((k) => `unset ${k}`),
      ...Object.entries(modeResult.vars).map(([k, v]) => `export ${k}=${q(v)}`),
    ].join("; ");
    // Resolve the tool inside the same login shell before handing over so a
    // missing tool surfaces our actionable message rather than a bare
    // `command not found`. `command -v` honors the aliases/functions/PATH the
    // spawn below would use. The direct-spawn branch relies on ENOENT instead.
    const guard = `command -v -- ${q(tool)} >/dev/null 2>&1 || { printf '%s\\n' ${q(notFoundMessage)} >&2; exit 127; }`;
    const command = `${reapply ? `${reapply}; ` : ""}${guard}; ${tool} "$@"`;
    child = spawn(aliasShell, ["-i", "-c", command, tool, ...finalArgs], {
      stdio: "inherit",
      env,
    });
  } else {
    // Windows (npm installs the tools as `.cmd` shims, so resolve via the
    // shell) or a shell we don't special-case (fish, etc.): spawn directly.
    child = spawn(tool, finalArgs, {
      stdio: "inherit",
      env,
      shell: process.platform === "win32",
    });
  }
  child.on("error", (err) => {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      process.stderr.write(`${notFoundMessage}\n`);
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
