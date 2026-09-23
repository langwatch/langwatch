/**
 * exec wrapper for `langwatch claude`/`codex`/`cursor`/`gemini`. Uses spawn()
 * rather than execve replacement (Node has none) — functionally equivalent
 * for the end user, and unlike execve, it works on Windows too.
 */

import { spawn } from "node:child_process";

import { normalizeEndpoint } from "../../../internal/endpoint";
import { createSpinner } from "../spinner";
import { lwTag } from "./brand";
import { checkBudget, renderBudgetExceeded } from "./budget";
import { updateLangwatchClaudePlugin } from "./claude-plugin";
import { getCliBootstrap } from "./cli-api";
import { recordCliLocation } from "./cli-location";
import { createCodexIOStreamer } from "./codex-rollout-otlp";
import type { GovernanceConfig } from "./config";
import { isLoggedIn, loadConfig, saveConfig } from "./config";
import { copilotGatewayModelPreflight, copilotPrespawnWarnings } from "./copilot-prespawn";
import { runDeviceFlowLogin } from "./login-flow";
import { clearToolProjectPin, pinToolToProject } from "./project-scope";
import { maybeOfferIngestionShellRcPersist, SHELL_FUNCTION_TOOLS } from "./shell-rc";
import { envForTool } from "./tool-env";
import { aliasShellFor, infoRunKind, runInfoRun, toolNotFoundMessage } from "./wrapper-info-run";
import { resolveWrapperMode } from "./wrapper-mode";
import {
  parseProjectScopeFlags,
  parseToolModeFlag,
  resolveWrapperPath,
} from "./wrapper-path-choice";
import { classifyIngestionSetupError, recoverExpiredSession } from "./wrapper-session-recovery";

/**
 * How often the wrapper polls codex's append-only rollout while the session
 * runs, streaming each completed turn's I/O instead of one burst on exit.
 */
const CODEX_IO_POLL_MS = 2_500;

/** Single-quote a string for safe interpolation into a `sh -c` command. */
const shellQuote = (s: string): string => `'${s.replace(/'/g, "'\\''")}'`;

/**
 * Provider families the tool needs upstream, checked by `preflightWrapper`
 * so a missing provider fails with a clear message instead of a confusing
 * tool-side error. Multi-provider tools match any listed family.
 */
const TOOL_PROVIDER_FAMILIES: Record<string, string[]> = {
  claude: ["anthropic"],
  codex: ["openai"],
  cursor: ["anthropic", "openai"],
  gemini: ["google", "gemini"],
  opencode: ["anthropic", "openai"],
  // copilot always speaks the OpenAI wire format to the gateway
  // (ADR-039 Decision 4), but the gateway can translate to either
  // upstream, so both families satisfy preflight. Model-level
  // servability (a Claude-family model against an openai-only org)
  // cannot be validated here — see ADR-039 open questions.
  copilot: ["openai", "anthropic"],
};

export interface PreflightResult {
  ok: boolean;
  /** Human-readable, action-oriented message rendered to stderr on failure. */
  message?: string;
  /**
   * True when a retry might clear this on its own (gateway momentarily
   * unreachable); false/absent means the path is structurally unusable
   * (no virtual key/provider), so a pinned choice should be forgotten.
   */
  retryable?: boolean;
}

/**
 * Whether to forget a pinned gateway choice after a failed preflight: only
 * when gateway was pinned and the failure is structural (no virtual
 * key/provider), not a retryable gateway-down — so the next run can retry.
 */
export function shouldForgetGatewayPin(args: {
  pinnedMode: string | undefined;
  retryable: boolean | undefined;
}): boolean {
  return args.pinnedMode === "gateway" && args.retryable !== true;
}

export interface PreflightOptions {
  fetchImpl?: typeof fetch;
  bootstrapImpl?: typeof getCliBootstrap;
  /** Per-probe timeout, ms. Default 3000. */
  timeoutMs?: number;
}

/**
 * Renders the "who to talk to" footer for preflight failures. `adminEmail`
 * comes from bootstrap and is null on legacy/unreachable control planes,
 * falling back to a generic line.
 */
function renderContactFooter(adminEmail: string | null | undefined): string {
  if (adminEmail) {
    return `Need help? Contact your LangWatch admin: ${adminEmail}\n`;
  }
  return `If you need help, contact your LangWatch admin.\n`;
}

/**
 * Pre-exec probe for `langwatch <tool>`: (1) a personal virtual-key secret
 * is set, else the tool silently calls upstream directly; (2) the gateway's
 * /healthz is reachable (fatal, no retry loop); (3) providers cover the tool.
 */
export async function preflightWrapper(
  cfg: GovernanceConfig,
  tool: string,
  opts: PreflightOptions = {},
): Promise<PreflightResult> {
  const cp = normalizeEndpoint(cfg.control_plane_url);
  const bootstrap = await (opts.bootstrapImpl ?? getCliBootstrap)(cfg).catch(() => null);
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

  const gw = normalizeEndpoint(cfg.gateway_url);
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
        retryable: true,
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
      retryable: true,
      message:
        `Cannot reach AI Gateway at ${gw}\n` +
        `  ${(err as Error).message}\n` +
        `Check that the LangWatch gateway is running, or set LANGWATCH_GATEWAY_URL\n` +
        `if you've deployed it elsewhere.\n` +
        renderContactFooter(adminEmail),
    };
  }

  // The gateway program is opt-in per tool: an org must publish that tool's
  // coding-assistant tile before we route a virtual key through it. `tools`
  // undefined means a legacy server that can't report the catalog, so skip
  // the gate for back-compat.
  if (Array.isArray(bootstrap?.tools)) {
    const published = bootstrap.tools.some((t) => t.slug === tool);
    if (!published) {
      return {
        ok: false,
        message:
          `The gateway isn't enabled for \`${tool}\` in your organization.\n` +
          `An admin needs to publish a ${tool} coding-assistant tile in the\n` +
          `AI Tools catalog (with the gateway path enabled):\n` +
          `  ${cp}/governance/tool-catalog\n` +
          renderContactFooter(adminEmail),
      };
    }
  }

  // The gateway routes through CONFIGURED provider credentials, not the curated
  // model_provider catalog tiles (those only gate the /me one-click "mint your
  // own VK" surface). Prefer the credential-derived families; fall back to the
  // tile list only on legacy servers that don't send `gatewayProviders`.
  const need = TOOL_PROVIDER_FAMILIES[tool];
  const configured = bootstrap?.gatewayProviders ?? bootstrap?.providers?.map((p) => p.name);
  if (need && need.length > 0 && Array.isArray(configured)) {
    const have = new Set(configured.map((n) => n.toLowerCase()));
    const matches = need.filter((n) => have.has(n));
    if (matches.length === 0) {
      const list = need.map((n) => `\`${n}\``).join(" or ");
      return {
        ok: false,
        message:
          `No ${list} provider credential is configured for your organization.\n` +
          `\`langwatch ${tool}\` needs at least one enabled provider to route\n` +
          `requests through the gateway. If you're an admin, add one at\n` +
          `  ${cp}/settings/model-providers\n` +
          renderContactFooter(adminEmail),
      };
    }
  }

  return { ok: true };
}

/**
 * Decide whether to auto-trigger device-flow login or fail fast: the
 * device flow needs a TTY, so default ON only when stdin is a TTY.
 * Override via `LANGWATCH_AUTO_LOGIN=1` or `=0`.
 */
function shouldAutoLogin(): boolean {
  const flag = process.env.LANGWATCH_AUTO_LOGIN;
  if (flag === "1" || flag === "true") return true;
  if (flag === "0" || flag === "false") return false;
  return Boolean(process.stdin.isTTY);
}

/**
 * Env re-application run inside `$SHELL -i -c` after the rc is sourced, so
 * the wrapper's vars win over the rc's. Also `unset -f`s scoped-function
 * tools so a persisted rc function can't reapply its frozen env and win.
 */
export function buildShellReapply(args: {
  tool: string;
  clears: string[];
  vars: Record<string, string>;
}): string {
  const parts: string[] = [];
  if (SHELL_FUNCTION_TOOLS.includes(args.tool)) {
    parts.push(`unset -f ${args.tool} 2>/dev/null`);
  }
  parts.push(...args.clears.map((k) => `unset ${k}`));
  parts.push(...Object.entries(args.vars).map(([k, v]) => `export ${k}=${shellQuote(v)}`));
  return parts.join("; ");
}

/**
 * Runs one telemetry setup step behind a spinner, since it used to run in
 * silence long enough to read as a hang. `discardStdin:false` for the same
 * reason login-flow sets it — ora's raw-mode default swallows Ctrl+C.
 */
export async function withTelemetrySetupSpinner<T>({
  tool,
  run,
}: {
  tool: string;
  run: () => Promise<T>;
}): Promise<T> {
  const spinner = createSpinner({
    text: `Setting up telemetry for ${tool}...`,
    discardStdin: false,
  });
  spinner.start();
  try {
    return await run();
  } finally {
    spinner.stop();
  }
}

/**
 * Run the named tool routed through the gateway, inheriting stdio for the
 * same interactive UX as invoking it directly. Exits the parent with the
 * child's exit code (or 2 if the budget pre-check fired).
 */
export async function runWrapped(tool: string, args: string[]): Promise<never> {
  // A help or version run starts no session: it goes to the tool before
  // anything below reads the config, signs in, mints a key or writes wiring.
  const infoRun = infoRunKind(args);
  if (infoRun) return runInfoRun({ tool, args, kind: infoRun });

  // Before the config is read, so every save below carries it. The Claude
  // Code plugin's hooks run the CLI through this record when PATH cannot
  // resolve it, which is the case for a Claude Code started from a desktop
  // app.
  recordCliLocation();
  let cfg = loadConfig();
  if (!isLoggedIn(cfg)) {
    if (!shouldAutoLogin()) {
      process.stderr.write("Not logged in. Run `langwatch login --device` first.\n");
      process.exit(1);
    }
    process.stderr.write("Not logged in. Starting device-flow login...\n");
    try {
      cfg = await runDeviceFlowLogin({ cfg });
    } catch (err) {
      process.stderr.write(`login failed: ${(err as Error).message ?? "unknown error"}\n`);
      process.exit(1);
    }
    if (!isLoggedIn(cfg)) {
      process.stderr.write("login did not complete - exiting\n");
      process.exit(1);
    }
  }

  // Wrapper-only telemetry-scope flags, stripped before anything reaches
  // the child. `--project` pins this tool's telemetry to a team project
  // (minting a project ingest key); `--personal` clears the pin.
  const scopeFlags = parseProjectScopeFlags(args);
  if (scopeFlags.personal && scopeFlags.project) {
    process.stderr.write(`${lwTag()} pass either --project or --personal, not both.\n`);
    process.exit(2);
  }
  if (scopeFlags.personal) {
    const cleared = clearToolProjectPin({ cfg, tool });
    process.stderr.write(
      cleared
        ? `${lwTag()} cleared the project pin for ${tool}; telemetry goes to your personal workspace again.\n`
        : `${lwTag()} ${tool} has no project pin; telemetry already goes to your personal workspace.\n`,
    );
  }
  if (scopeFlags.project) {
    try {
      const pinned = await pinToolToProject({
        cfg,
        tool,
        project: scopeFlags.project,
      });
      process.stderr.write(`${lwTag()} pinned ${tool} telemetry to project ${pinned.label}.\n`);
    } catch (err) {
      process.stderr.write(
        `${lwTag()} could not pin ${tool} to project ${scopeFlags.project}: ` +
          `${(err as Error).message}\n`,
      );
      process.exit(2);
    }
  }

  // Strip the wrapper-only `--tool-mode` flag from the args BEFORE anything
  // forwards them to the real tool, and resolve any explicit override.
  // Everything else stays verbatim + in order for the child invocation.
  const parsedMode = parseToolModeFlag(scopeFlags.args);
  const toolArgs = parsedMode.args;
  // A project pin means telemetry-only by definition, so it behaves like
  // an explicit direct-OTLP override: no gateway-vs-subscription prompt,
  // no tool_mode persistence. A literal --tool-mode flag still wins.
  const pathOverride =
    parsedMode.override ?? (cfg.tool_project_keys?.[tool]?.secret ? "ingestion" : undefined);

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
      refreshPolicies: (c) => getCliBootstrap(c).then((b) => b?.toolPolicies ?? null),
    });
  } catch (err) {
    process.stderr.write(`path selection failed: ${(err as Error).message}\n`);
    process.exit(2);
  }
  if (pathChoice.isAborted) {
    process.stderr.write(`${lwTag()} cancelled, ${tool} was not started.\n`);
    process.exit(130);
  }

  const toolEnv = envForTool(cfg, tool);
  const gatewayVars = toolEnv.vars;
  const gatewayClears = toolEnv.clears ?? [];
  let modeResult;
  try {
    modeResult = await withTelemetrySetupSpinner({
      tool,
      run: () => resolveWrapperMode(cfg, tool, gatewayVars, gatewayClears, pathChoice.mode),
    });
  } catch (err) {
    // Direct-OTLP setup can fail at mint time (expired session, no
    // workspace yet, control plane unreachable); none of those justify
    // routing through the gateway, which bills the org and needs opt-in.
    // An expired session is recoverable, so retry after inline login.
    if (pathChoice.mode === "ingestion" && classifyIngestionSetupError(err) === "expired_session") {
      const recovery = await recoverExpiredSession({ cfg, tool });
      if (recovery.status === "abort") {
        process.stderr.write(recovery.message);
        process.exit(recovery.exitCode);
      }
      cfg = recovery.cfg;
      // The fresh login may carry a different personal VK, so recompute
      // the gateway env from the new config rather than reusing the pair
      // derived from the expired session.
      const refreshedEnv = envForTool(cfg, tool);
      try {
        modeResult = await withTelemetrySetupSpinner({
          tool,
          run: () =>
            resolveWrapperMode(
              cfg,
              tool,
              refreshedEnv.vars,
              refreshedEnv.clears ?? [],
              "ingestion",
            ),
        });
      } catch (err2) {
        process.stderr.write(
          `${lwTag()} still could not set up direct OTLP telemetry for ` +
            `${tool}: ${(err2 as Error).message}\n`,
        );
        process.exit(2);
      }
    } else {
      process.stderr.write(
        `${lwTag()} could not set up telemetry for ${tool}: ` + `${(err as Error).message}\n`,
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

  // Latest-login-wins feedback: name every persisted telemetry target the
  // resolver re-synced because a previous install left stale values, plus
  // any change to the claude project-level pin, so silent rerouting of
  // telemetry is never silent to the user.
  for (const label of modeResult.refreshedWiring ?? []) {
    process.stderr.write(`${lwTag()} refreshed ${label} to point at this login.\n`);
  }
  const pin = modeResult.claudeProjectPin;
  if (pin?.action === "created") {
    process.stderr.write(
      `${lwTag()} pinned claude telemetry for this directory in ` +
        `.claude/settings.local.json (project settings outrank ` +
        `~/.claude/settings.json). \`langwatch logout\` here removes it.\n`,
    );
  } else if (pin?.action === "updated") {
    process.stderr.write(
      `${lwTag()} refreshed the claude telemetry pin in ` +
        `.claude/settings.local.json to point at this login.\n`,
    );
  } else if (pin?.action === "removed") {
    process.stderr.write(
      `${lwTag()} removed the langwatch telemetry env from ` +
        `.claude/settings.local.json (the gateway captures this session).\n`,
    );
  } else if (pin?.action === "skipped") {
    process.stderr.write(
      `${lwTag()} left the OTLP env in .claude/settings.local.json alone, ` +
        `it isn't langwatch-authored. Claude applies it on top of this ` +
        `run's env, so telemetry may go elsewhere: remove those keys or ` +
        `point them at ${modeResult.endpoint ?? "this login"}.\n`,
    );
  }

  // Copilot-only pre-spawn warnings (enterprise managed-settings OTel
  // pin + version gate). Deliberately OUTSIDE the gateway-only preflight
  // below — copilot defaults to ingestion, and both conditions make
  // capture silently incomplete on either path (ADR-039 D8/D9).
  if (tool === "copilot") {
    for (const warning of copilotPrespawnWarnings()) {
      process.stderr.write(`${warning}\n`);
    }
  }

  // Copilot BYOK (gateway) requires a model; fail fast with an actionable
  // message instead of copilot's opaque downstream error.
  if (modeResult.mode === "gateway" && tool === "copilot") {
    const modelError = copilotGatewayModelPreflight({
      args: toolArgs,
      env: process.env,
    });
    if (modelError) {
      process.stderr.write(`${lwTag()} ${modelError}\n`);
      process.exit(1);
    }
  }

  if (modeResult.mode === "gateway") {
    // Budget pre-check - render Screen-8 box + exit 2 BEFORE exec. Gateway
    // runs only: the budget gates gateway spend, and an ingestion run
    // spends nothing through us, so subscription users skip the call.
    const exceeded = await checkBudget(cfg);
    if (exceeded) {
      process.stderr.write(
        renderBudgetExceeded(exceeded, {
          fallbackUrl: `${cfg.control_plane_url}/me/budget/request`,
        }),
      );
      process.exit(2);
    }
    const probe = await preflightWrapper(cfg, tool);
    if (!probe.ok) {
      process.stderr.write(probe.message ?? "preflight failed\n");
      // A remembered gateway choice that can't actually serve this account/org
      // (no virtual key / no provider configured) would re-fail every run. Drop
      // the pin so the next run re-asks and the user can pick direct OTLP. A
      // transient gateway-down failure keeps the pin (a retry may succeed).
      if (
        shouldForgetGatewayPin({
          pinnedMode: cfg.tool_mode?.[tool],
          retryable: probe.retryable,
        })
      ) {
        const toolMode = { ...cfg.tool_mode };
        delete toolMode[tool];
        cfg.tool_mode = toolMode;
        try {
          saveConfig(cfg);
          process.stderr.write(
            `${lwTag()} cleared the saved gateway path for \`${tool}\`; ` +
              `you'll be asked again next time so you can pick direct OTLP.\n`,
          );
        } catch {
          // Best-effort: a config write failure just leaves the pin in place.
          void 0;
        }
      }
      process.exit(2);
    }
    if (modeResult.codexConfigPath) {
      process.stderr.write(
        `${lwTag()} wired [model_providers.langwatch] in ${modeResult.codexConfigPath}.\n`,
      );
    }
    if (modeResult.codexProfilePath) {
      process.stderr.write(`${lwTag()} wrote profile body to ${modeResult.codexProfilePath}.\n`);
    }
  } else {
    // ingestion mode side-effect feedback so the user sees what
    // the wrapper just did on their behalf.
    if (modeResult.projectScope) {
      process.stderr.write(
        `${lwTag()} telemetry goes to project ` +
          `${modeResult.projectScope.label ?? "(pinned ingest key)"}.\n`,
      );
    }
    if (modeResult.newKeyMinted) {
      process.stderr.write(`${lwTag()} minted a personal ingestion key for ${tool}.\n`);
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

  // Keep the installed plugin current, whichever tool this run wraps —
  // installed once per machine, not once per tool. Stamped to once a day
  // and runs BEFORE spawn so a new version reaches this session rather
  // than the next. Housekeeping: warns and continues on failure.
  const pluginUpdate = updateLangwatchClaudePlugin({
    // Said before the work, not after it: the check fetches from a network
    // that may be slow or half-open, and a launch that pauses without
    // explanation reads as the wrapper having hung.
    onCheckStart: () =>
      process.stderr.write(
        `${lwTag()} checking whether the LangWatch plugin for Claude Code ` + `is up to date.\n`,
      ),
  });
  if (pluginUpdate.action === "updated") {
    process.stderr.write(
      `${lwTag()} updated the LangWatch plugin for Claude Code, ` +
        `${pluginUpdate.from} to ${pluginUpdate.to}.\n`,
    );
  } else if (pluginUpdate.action === "failed") {
    process.stderr.write(
      `${lwTag()} couldn't update the LangWatch plugin for Claude Code ` +
        `(best-effort, continuing): ${pluginUpdate.reason}\n`,
    );
  }

  // Scrub conflicting twins from the inherited env before merging ours in.
  // Legacy creds (e.g. ANTHROPIC_API_KEY) would otherwise race with the
  // gateway-routed ANTHROPIC_AUTH_TOKEN, surfacing as claude-code's "auth
  // may not work as expected" warning or a wrong credential picked silently.
  const parentEnv = { ...process.env };
  for (const key of modeResult.clears ?? []) {
    delete parentEnv[key];
  }
  const env = { ...parentEnv, ...modeResult.vars };
  // Forward the user's args verbatim and in order, minus the stripped
  // wrapper flag (`--tool-mode`). Any mode-specific prepends (e.g. codex
  // `--profile langwatch-gateway`) lead.
  const finalArgs = [...(modeResult.extraArgs ?? []), ...toolArgs];

  // Resolve the tool via the user's interactive login shell (zsh/bash) so
  // aliases/functions are honored, not just the PATH binary. `-i` sources
  // the rc, and the wrapper's env is re-applied *after* so the rc can't
  // clobber gateway/OTLP wiring. Args ride "$@" unquoted; `tool` is
  // whitelisted so the command string is safe from injection.
  const aliasShell = aliasShellFor();

  const notFoundMessage = toolNotFoundMessage(tool);

  // Stamp the session start so the codex rollout harvest only reads rollout
  // files this run produced (codex names them by start time + mtime).
  const sessionStartMs = Date.now();

  // Codex's OTLP spans carry tokens + model only, but its rollout file has
  // the full transcript with a per-turn trace_id. Poll it while codex runs
  // to stream each turn as it completes rather than one burst on exit; the
  // poll and a final sweep are idempotent (span id is trace_id-derived).
  let codexStreamer: ReturnType<typeof createCodexIOStreamer> | null = null;
  if (tool === "codex") {
    if (modeResult.mode === "ingestion") {
      if (modeResult.endpoint) {
        if (modeResult.ingestionToken) {
          codexStreamer = createCodexIOStreamer({
            sinceMs: sessionStartMs,
            endpoint: `${normalizeEndpoint(modeResult.endpoint)}/v1/traces`,
            logsEndpoint: `${normalizeEndpoint(modeResult.endpoint)}/v1/logs`,
            token: modeResult.ingestionToken,
          });
        }
      }
    }
  }
  let codexPoll: ReturnType<typeof setInterval> | null = null;
  if (codexStreamer) {
    let inFlight = false;
    codexPoll = setInterval(() => {
      // Skip a tick if the previous harvest (file read + POST, ≤5s) is still
      // running so slow ticks can't pile up.
      if (inFlight) return;
      inFlight = true;
      void codexStreamer
        .harvest(Date.now())
        .catch(() => 0)
        .finally(() => {
          inFlight = false;
        });
    }, CODEX_IO_POLL_MS);
    // The child process drives the lifecycle; never let the poll keep the event
    // loop alive on its own.
    codexPoll.unref?.();
  }

  let child;
  if (aliasShell) {
    const reapply = buildShellReapply({
      tool,
      clears: modeResult.clears ?? [],
      vars: modeResult.vars,
    });
    // Resolve the tool inside the same login shell before handing over so a
    // missing tool surfaces our actionable message rather than a bare
    // `command not found`. `command -v` honors the aliases/functions/PATH the
    // spawn below would use. The direct-spawn branch relies on ENOENT instead.
    const guard = `command -v -- ${shellQuote(tool)} >/dev/null 2>&1 || { printf '%s\\n' ${shellQuote(notFoundMessage)} >&2; exit 127; }`;
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
  const exitCode = await new Promise<number>((resolve) => {
    child.on("close", (code) => resolve(code ?? 1));
  });

  // Stop polling and do one final sweep so the last turn (completed between the
  // last poll and exit) still lands. Best-effort: a coding session must never
  // fail or stall on the content harvest.
  if (codexPoll) clearInterval(codexPoll);
  if (codexStreamer) {
    try {
      await codexStreamer.harvest(Date.now());
    } catch {
      /* content recovery is non-essential; never block exit on it */
      void 0;
    }
  }

  process.exit(exitCode);
}
