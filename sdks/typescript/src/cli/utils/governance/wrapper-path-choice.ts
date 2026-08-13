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
 *   5. both allowed + non-TTY / CI / LANGWATCH_AUTO_LOGIN - direct OTLP,
 *      no prompt, no persist. Nobody is there to consent to the gateway
 *      billing model usage to the org, so it is never chosen implicitly.
 *
 * Cancelling the prompt in case 4 cancels the run rather than picking a
 * path on the user's behalf.
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
  /**
   * True when the user cancelled the path prompt. `mode` is then a
   * placeholder the caller must not act on; it should stop the run.
   */
  isAborted?: boolean;
}

/**
 * Human-readable copy for the interactive select. Kept as exported
 * helpers so tests can assert it and the wording stays in one place.
 *
 * The OTLP (ingestion) option is listed first and is the default: most
 * users reaching this prompt already pay for the tool's own subscription
 * and want LangWatch to observe their usage, not re-bill it. The gateway
 * (API key) path is the explicit opt-in.
 */
export function pathChoiceMessage(tool: string): string {
  return `How should \`langwatch ${tool}\` run?`;
}

export function gatewayChoiceTitle(): string {
  return "Using an API key";
}

export function gatewayChoiceDescription(): string {
  return "route calls through LangWatch with a virtual key";
}

/**
 * Per-tool subscription noun for the OTLP (bring-your-own-plan) option:
 * claude runs on a Claude subscription, codex on a ChatGPT subscription,
 * gemini on a Gemini subscription, cursor on a Cursor subscription.
 * Tools without a well-known subscription (opencode is a bring-your-own
 * client) fall back to a neutral "your own <tool> plan".
 */
const OTLP_TITLE_BY_TOOL = {
  claude: "Using a Claude subscription",
  codex: "Using a ChatGPT subscription",
  gemini: "Using a Gemini subscription",
  cursor: "Using a Cursor subscription",
} as const satisfies Record<string, string>;

export function otlpChoiceTitle(tool: string): string {
  // Own-property check (not `in`) so inherited names like "toString" take
  // the fallback path. hasOwnProperty.call keeps the SDK's pre-ES2022 lib
  // target happy where Object.hasOwn does not typecheck.
  if (Object.prototype.hasOwnProperty.call(OTLP_TITLE_BY_TOOL, tool)) {
    return OTLP_TITLE_BY_TOOL[tool as keyof typeof OTLP_TITLE_BY_TOOL];
  }
  return `Using your own ${tool} plan`;
}

export function otlpChoiceDescription(): string {
  return "keep your own plan, send only telemetry to LangWatch";
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
    // Explicit or not, a copilot gateway route shifts spend off the user's
    // Copilot seat — every route that lands there names the shift (ADR-039
    // D3): here, the pinned branch below, the policy branches, and
    // resolveWrapperMode's downgrade.
    if (
      override === "gateway" &&
      resolvePlatformToolPolicy(tool, cfg.tool_policies).allowVk
    ) {
      // Policy gate: when the org disables the gateway, resolveWrapperMode
      // downgrades this run to ingestion with its own notice — warning about
      // a billing shift that then doesn't happen would be false.
      const suffix = copilotSeatBypassSuffix(tool);
      if (suffix) {
        writeImpl(`${lwTag()} using the gateway (--tool-mode).${suffix}\n`);
      }
    }
    return { mode: override, prompted: false };
  }

  // 2. Remembered answer pinned in cfg.tool_mode[tool].
  const pinned = cfg.tool_mode?.[tool];
  if (pinned === "gateway" || pinned === "ingestion") {
    if (
      pinned === "gateway" &&
      resolvePlatformToolPolicy(tool, cfg.tool_policies).allowVk
    ) {
      const suffix = copilotSeatBypassSuffix(tool);
      if (suffix) {
        writeImpl(
          `${lwTag()} using your saved gateway preference for ${tool}.${suffix}\n`,
        );
      }
    }
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
    // Non-TTY / CI / forced-auto-login: nobody is there to answer, and the
    // gateway bills model usage to the organization. Take the same option
    // the prompt pre-selects, which costs nothing beyond telemetry. A CI
    // job that wants the gateway asks for it with --tool-mode=gateway,
    // LANGWATCH_TOOL_MODE=gateway, or a pinned tool_mode. This also keeps
    // copilot billing-safe (ADR-039 D3): its gateway path rides
    // COPILOT_PROVIDER_* BYOK keys, shifting spend off the user's seat.
    return { mode: "ingestion", prompted: false };
  }

  const res = await promptImpl({
    type: "select",
    name: "path",
    message: pathChoiceMessage(tool),
    // Subscription (OTLP) first and pre-selected; API key (gateway) is the
    // explicit opt-in. Values stay "gateway"/"ingestion" - they are the
    // persisted cfg.tool_mode vocabulary.
    choices: [
      {
        title: otlpChoiceTitle(tool),
        description: otlpChoiceDescription(),
        value: "ingestion",
      },
      {
        title: gatewayChoiceTitle(),
        description: gatewayChoiceDescription(),
        value: "gateway",
      },
    ],
    initial: 0,
  });

  const chosen = tokenToMode(res?.path as string | undefined);
  if (!chosen) {
    // User aborted the prompt (Ctrl-C / empty). Cancelling the question
    // cancels the run: picking a path for them would either start the tool
    // they just interrupted or bill their organization for it.
    return { mode: "ingestion", prompted: false, isAborted: true };
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

  const label =
    chosen === "gateway" ? "an API key (gateway)" : "your own plan (otlp)";
  // The prompt answer is the route that actually moves copilot spend off
  // the user's seat — it must name the shift like every other gateway
  // route (ADR-039 D3), not leave the user to learn it from the pinned
  // branch on run 2.
  const seatSuffix =
    chosen === "gateway" ? copilotSeatBypassSuffix(tool) : "";
  writeImpl(
    `${lwTag()} saved. \`${tool}\` will use ${label}. ` +
      `Override with --tool-mode=${chosen === "gateway" ? "otlp" : "gateway"}, ` +
      `or edit ~/.langwatch/config.json (tool_mode.${tool}).${seatSuffix}\n`,
  );

  return { mode: chosen, prompted: true };
}
