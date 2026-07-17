/**
 * Runtime path-selection UX for the `langwatch <tool>` wrapper.
 *
 * Before env injection + spawn, the wrapper has to decide which routing
 * shape to apply for this run:
 *
 *   - Path A "gateway"   - LLM calls route through the LangWatch gateway
 *                          via the user's personal virtual key. LLM usage
 *                          is billed to the gateway.
 *   - Path B "ingestion" - the tool calls its own provider with the
 *                          user's own plan/auth; only OTLP telemetry is
 *                          sent to LangWatch via the personal ingest key.
 *
 * Historically the wrapper silently picked the gateway whenever a VK was
 * present and never asked, even when the org policy allowed BOTH paths.
 * This module fixes that: when both paths are allowed, on a TTY, with no
 * remembered answer, it shows an interactive select and remembers the
 * choice in cfg.tool_mode[tool] (the existing per-tool routing field, so
 * the rest of the wrapper reads it the same way it always has).
 *
 * Precedence (highest first):
 *   1. explicit override - `--tool-mode=gateway|otlp` flag, then
 *      `LANGWATCH_TOOL_MODE=gateway|otlp` env. Never prompts, never persists.
 *   2. remembered answer - cfg.tool_mode[tool] pinned to gateway/ingestion.
 *   3. exactly one allowed path (policy gate) - used silently.
 *   4. both allowed + TTY + not forced-auto-login - PROMPT, persist the
 *      answer, print a one-line tip.
 *   5. both allowed + non-TTY / CI / LANGWATCH_AUTO_LOGIN - default gateway,
 *      no prompt, no persist.
 *
 * The `--tool-mode` flag is a WRAPPER flag: it is stripped from the args
 * before they are forwarded to the real tool. Every other arg is
 * forwarded verbatim and in order.
 */

import prompts from "prompts";

import { lwTag } from "./brand";
import type { GovernanceConfig } from "./config";
import { saveConfig } from "./config";
import { copilotSeatBypassSuffix, type WrapperMode } from "./wrapper-mode";
import {
  resolvePlatformToolPolicy,
  type PlatformToolPolicyMap,
} from "./platform-tool-policy";

/** Wrapper-only flag name. */
const TOOL_MODE_FLAG = "--tool-mode";

/**
 * The silent default when both paths are allowed and nothing is pinned.
 *
 * Every tool except copilot defaults to the gateway. Copilot inverts it
 * (ADR-039 Decision 3): its gateway path rides COPILOT_PROVIDER_* BYOK
 * env vars, which switch spend off the user's already-paid Copilot seat
 * onto the org's provider API keys — NOT billing-neutral the way the
 * claude/codex base-URL swap is (same API key either way there). A
 * silent default must never shift who pays, so copilot's three silent
 * gateway defaults (non-TTY fallback, prompt pre-selection, prompt
 * abort) all resolve to ingestion instead. Explicit choices — flag,
 * env, pinned mode, org policy — are honored unchanged.
 */
function silentDefaultMode(tool: string): WrapperMode {
  return tool === "copilot" ? "ingestion" : "gateway";
}

/**
 * Map a user-facing path token (`gateway` / `otlp`) to the internal
 * WrapperMode vocabulary (`gateway` / `ingestion`). Returns null for an
 * unrecognized token so the caller can ignore a typo rather than crash.
 */
function tokenToMode(token: string | undefined): WrapperMode | null {
  const t = (token ?? "").trim().toLowerCase();
  if (t === "gateway" || t === "vk") return "gateway";
  if (t === "otlp" || t === "ingestion" || t === "direct") return "ingestion";
  return null;
}

export interface ParsedToolMode {
  /** Args with every `--tool-mode` form removed, order otherwise preserved. */
  args: string[];
  /** The override mode if `--tool-mode` (or LANGWATCH_TOOL_MODE env) set one. */
  override?: WrapperMode;
}

/**
 * Strip the wrapper-only `--tool-mode` flag from the forwarded args and
 * resolve any explicit override. Supports both `--tool-mode=gateway` and
 * the space-separated `--tool-mode gateway` form. Falls back to the
 * `LANGWATCH_TOOL_MODE` env var when the flag is absent (the flag wins).
 *
 * CRITICAL: only `--tool-mode` is consumed. Every other arg (including
 * flags like `--dangerously-skip-permissions` and quoted positional
 * values) is forwarded untouched and in order.
 */
export function parseToolModeFlag(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): ParsedToolMode {
  const out: string[] = [];
  let flagOverride: WrapperMode | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === TOOL_MODE_FLAG) {
      // Space-separated form: consume the next token as the value.
      const value = args[i + 1];
      const mode = tokenToMode(value);
      if (mode) flagOverride = mode;
      // Skip the value token too (whether or not it parsed) so a bare
      // `--tool-mode gateway` never leaks `gateway` to the child as a
      // stray positional.
      if (value !== undefined) i++;
      continue;
    }
    if (arg.startsWith(`${TOOL_MODE_FLAG}=`)) {
      const value = arg.slice(TOOL_MODE_FLAG.length + 1);
      const mode = tokenToMode(value);
      if (mode) flagOverride = mode;
      continue;
    }
    out.push(arg);
  }

  const override = flagOverride ?? tokenToMode(env.LANGWATCH_TOOL_MODE) ?? undefined;
  return { args: out, override };
}

/**
 * Whether an explicit forced-auto-login signal is set. The path prompt
 * is skipped in that case (CI / agent contexts that opted into the
 * non-interactive device flow shouldn't get stuck on an extra select).
 * Mirrors the LANGWATCH_AUTO_LOGIN handling in the wrapper's login gate.
 */
function isForcedAutoLogin(env: NodeJS.ProcessEnv): boolean {
  const flag = env.LANGWATCH_AUTO_LOGIN;
  return flag === "1" || flag === "true";
}

export interface ResolveWrapperPathOptions {
  cfg: GovernanceConfig;
  tool: string;
  /** Args already passed through `parseToolModeFlag` (flag stripped). */
  args: string[];
  /** Explicit override from `parseToolModeFlag`, if any. */
  override?: WrapperMode;
  /** TTY detection seam for tests. Defaults to stdin AND stdout being a TTY. */
  isTTY?: boolean;
  /** Prompt seam for tests. Defaults to the real `prompts` select. */
  promptImpl?: typeof prompts;
  /** Persist seam for tests. Defaults to the real saveConfig. */
  saveImpl?: typeof saveConfig;
  /** Output seam for tests. Defaults to process.stderr.write. */
  writeImpl?: (s: string) => void;
  env?: NodeJS.ProcessEnv;
  /**
   * Re-fetch the org's per-tool path policy at run time. Invoked only when
   * the decision rides on policy (no override, no remembered answer), so a
   * path the admin disabled AFTER login is honored without a re-login. Returns
   * null (or throws) when offline; the resolver then keeps the cached map.
   */
  refreshPolicies?: (
    cfg: GovernanceConfig,
  ) => Promise<PlatformToolPolicyMap | null>;
}

export interface ResolveWrapperPathResult {
  /**
   * The mode to force into resolveWrapperMode. Always concrete so the
   * wrapper never falls back to the silent VK-present-implies-gateway
   * default. resolveWrapperMode still applies the policy gates on top
   * (downgrade / throw) so a forced mode the admin disabled is handled.
   */
  mode: WrapperMode;
  /** True when this run made a fresh interactive choice (and persisted it). */
  prompted: boolean;
}

/**
 * Human-readable copy for the interactive select. Kept as a constant so
 * tests can assert it and the wording stays in one place.
 */
export function pathChoiceMessage(tool: string): string {
  return `How should \`langwatch ${tool}\` run?`;
}

export function gatewayChoiceTitle(): string {
  return "Gateway (virtual key) - route LLM calls through LangWatch (usage billed per token)";
}

export function otlpChoiceTitle(tool: string): string {
  return `Direct OTLP - use your own ${tool} plan, send only telemetry to LangWatch`;
}

/**
 * Resolve the path for this `langwatch <tool>` run. Prompts (and
 * persists) only when both paths are allowed, on a TTY, with no
 * remembered answer and no forced-auto-login. See the module header for
 * the full precedence.
 */
export async function resolveWrapperPath(
  opts: ResolveWrapperPathOptions,
): Promise<ResolveWrapperPathResult> {
  const {
    cfg,
    tool,
    override,
    promptImpl = prompts,
    saveImpl = saveConfig,
    writeImpl = (s: string) => void process.stderr.write(s),
    env = process.env,
  } = opts;
  const isTTY =
    opts.isTTY ?? (Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY));

  // 1. Explicit override (flag or env) wins outright - no prompt, no persist.
  if (override) {
    return { mode: override, prompted: false };
  }

  // 2. Remembered answer pinned in cfg.tool_mode[tool].
  const pinned = cfg.tool_mode?.[tool];
  if (pinned === "gateway" || pinned === "ingestion") {
    return { mode: pinned, prompted: false };
  }

  // 3. No override and no remembered answer: the decision rides on the org
  // policy, which the admin may have flipped since login. Refresh it from the
  // server (best-effort) so a freshly-disabled path is honored at run time,
  // then re-cache it. A saved tool_mode short-circuits above, so this costs a
  // request only on the runs before the user pins a path.
  if (opts.refreshPolicies) {
    try {
      const fresh = await opts.refreshPolicies(cfg);
      if (fresh) {
        cfg.tool_policies = fresh;
        try {
          saveImpl({ ...cfg, tool_policies: fresh });
        } catch {
          // best-effort re-cache; a write failure must not block the run.
        }
      }
    } catch {
      // offline / server error: fall back to the cached policy map.
    }
  }

  // Resolve which paths the org policy permits for this tool.
  const policy = resolvePlatformToolPolicy(tool, cfg.tool_policies);
  const allowGateway = policy.allowVk;
  const allowOtlp = policy.allowOtelDirect;

  // Exactly one allowed path is used silently. resolveWrapperMode also
  // enforces this (downgrade / throw), but resolving it here keeps the
  // prompt logic honest: we only ever prompt for a real either-or.
  if (allowGateway && !allowOtlp) {
    // Copilot lands on the gateway by admin policy here, BEFORE
    // resolveWrapperMode's downgrade branch can attach its notice — so
    // the who-pays shift must be named at this seam too (ADR-039 D3).
    const suffix = copilotSeatBypassSuffix(tool);
    if (suffix) {
      writeImpl(
        `${lwTag()} direct OTLP is disabled for ${tool} by your org admin; using the gateway.${suffix}\n`,
      );
    }
    return { mode: "gateway", prompted: false };
  }
  if (!allowGateway && allowOtlp) {
    return { mode: "ingestion", prompted: false };
  }
  if (!allowGateway && !allowOtlp) {
    // Both disabled - let resolveWrapperMode surface the canonical
    // tool-disabled error. Pick gateway here only to hand it a concrete
    // value; the gate throws before it matters.
    return { mode: "gateway", prompted: false };
  }

  // 4 / 5. Both paths allowed.
  const canPrompt = isTTY && !isForcedAutoLogin(env);
  if (!canPrompt) {
    // Non-TTY / CI / forced-auto-login - silent default, no prompt.
    return { mode: silentDefaultMode(tool), prompted: false };
  }

  const choices = [
    {
      title: gatewayChoiceTitle(),
      value: "gateway",
    },
    {
      title: otlpChoiceTitle(tool),
      value: "ingestion",
    },
  ];
  const res = await promptImpl({
    type: "select",
    name: "path",
    message: pathChoiceMessage(tool),
    choices,
    initial: choices.findIndex((c) => c.value === silentDefaultMode(tool)),
  });

  const chosen = tokenToMode(res?.path as string | undefined);
  if (!chosen) {
    // User aborted the prompt (Ctrl-C / empty). Fall back to the silent
    // default for this run without persisting, so the next run asks again.
    return { mode: silentDefaultMode(tool), prompted: false };
  }

  // Remember the choice so subsequent runs don't prompt.
  const next: GovernanceConfig = {
    ...cfg,
    tool_mode: { ...(cfg.tool_mode ?? {}), [tool]: chosen },
  };
  try {
    saveImpl(next);
    // Mutate the in-memory cfg too so the rest of this run sees the pin.
    cfg.tool_mode = next.tool_mode;
  } catch {
    // Best-effort persist - a write failure shouldn't block the run.
  }

  const label = chosen === "gateway" ? "gateway" : "otlp";
  writeImpl(
    `${lwTag()} saved. \`${tool}\` will use the ${label} path. ` +
      `Override with --tool-mode=${chosen === "gateway" ? "otlp" : "gateway"}, ` +
      `or edit ~/.langwatch/config.json (tool_mode.${tool}).\n`,
  );

  return { mode: chosen, prompted: true };
}
