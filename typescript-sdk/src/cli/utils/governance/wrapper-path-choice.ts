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

import type { GovernanceConfig } from "./config";
import { saveConfig } from "./config";
import type { WrapperMode } from "./wrapper-mode";
import { resolvePlatformToolPolicy } from "./platform-tool-policy";

/** Wrapper-only flag name. */
const TOOL_MODE_FLAG = "--tool-mode";

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
  return "Gateway (virtual key) - route LLM calls through LangWatch (usage billed to the gateway)";
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

  // 3. Resolve which paths the org policy permits for this tool.
  const policy = resolvePlatformToolPolicy(tool, cfg.tool_policies);
  const allowGateway = policy.allowVk;
  const allowOtlp = policy.allowOtelDirect;

  // Exactly one allowed path is used silently. resolveWrapperMode also
  // enforces this (downgrade / throw), but resolving it here keeps the
  // prompt logic honest: we only ever prompt for a real either-or.
  if (allowGateway && !allowOtlp) {
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
    // Non-TTY / CI / forced-auto-login - default to the gateway, no prompt.
    return { mode: "gateway", prompted: false };
  }

  const res = await promptImpl({
    type: "select",
    name: "path",
    message: pathChoiceMessage(tool),
    choices: [
      {
        title: gatewayChoiceTitle(),
        value: "gateway",
      },
      {
        title: otlpChoiceTitle(tool),
        value: "ingestion",
      },
    ],
    initial: 0,
  });

  const chosen = tokenToMode(res?.path as string | undefined);
  if (!chosen) {
    // User aborted the prompt (Ctrl-C / empty). Default to the gateway
    // for this run without persisting, so the next run asks again.
    return { mode: "gateway", prompted: false };
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
    `langwatch: saved. \`${tool}\` will use the ${label} path. ` +
      `Override with --tool-mode=${chosen === "gateway" ? "otlp" : "gateway"}, ` +
      `or edit ~/.langwatch/config.json (tool_mode.${tool}).\n`,
  );

  return { mode: chosen, prompted: true };
}
