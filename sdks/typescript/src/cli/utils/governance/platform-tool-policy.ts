/**
 * Platform-tool policy table.
 *
 * Per-tool toggles that gate the two `langwatch <tool>` paths the
 * wrapper can take:
 *
 *   - allowVk: tool may route through the gateway via the user's
 *     personal VK (Path A). When false, the wrapper forces Path B
 *     even if a VK is present.
 *   - allowOtelDirect: tool may route via OTLP straight to
 *     `/api/otel/v1/logs` with the user's ingestion key (Path B).
 *     When false, the wrapper refuses to install Path B and surfaces
 *     a clear error.
 *
 * The resolver prefers the policy map the CLI cached at login
 * (`cfg.tool_policies`, served by the control plane's
 * PlatformToolPolicyService) and falls back to the hardcoded defaults
 * below when the cache is absent: an offline or legacy CLI that never
 * cached a map, or a tool the server did not return. The defaults must
 * stay in sync with the server-side PLATFORM_TOOL_POLICY_DEFAULTS.
 */

export type PlatformToolSlug =
  | "claude"
  | "codex"
  | "gemini"
  | "opencode"
  | "cursor"
  | "copilot"
  | "code"
  | "pi";

export interface PlatformToolPolicy {
  allowVk: boolean;
  allowOtelDirect: boolean;
}

/**
 * The login-cached policy map. Comes from config.json (untyped JSON),
 * so every slug is optional and a missing entry falls back to the
 * hardcoded default.
 */
export type PlatformToolPolicyMap = Partial<Record<string, PlatformToolPolicy>>;

const DEFAULTS: PlatformToolPolicy = {
  allowVk: true,
  allowOtelDirect: true,
};

export const PLATFORM_TOOL_POLICIES: Record<PlatformToolSlug, PlatformToolPolicy> = {
  claude: { ...DEFAULTS },
  codex: { ...DEFAULTS },
  gemini: { ...DEFAULTS },
  opencode: { ...DEFAULTS },
  // cursor is GUI-only; Path B is not meaningful (no terminal env
  // reaches the agent panel). The wrapper still gates on this so
  // future GUI integrations can flip allowOtelDirect to true.
  cursor: { allowVk: true, allowOtelDirect: false },
  // copilot (GitHub Copilot CLI >= 1.0.41) has native OTel export AND
  // BYOK gateway env vars, so both paths are real. ADR-039.
  copilot: { ...DEFAULTS },
  // code (VS Code Copilot Chat) is ingestion-only: the chat extension has
  // native OTel export but no BYOK gateway env, so Path A is not meaningful.
  // Inverse of cursor. ADR-039 §Extension #2.
  code: { allowVk: false, allowOtelDirect: true },
  // pi is ingestion-only. It emits no telemetry of its own, so Path B is the
  // wrapper reading pi's session file and posting it under the personal
  // ingestion key. Path A is NOT available: pi hardcodes each catalog model's
  // base URL and ignores OPENAI_BASE_URL / ANTHROPIC_BASE_URL entirely. Every
  // model in `@earendil-works/pi-ai`'s `models.generated.js` carries a literal
  // `baseUrl` (openai/gpt-5-mini -> https://api.openai.com/v1,
  // anthropic/claude-haiku-4-5 -> https://api.anthropic.com), and both client
  // factories pass it to the vendor SDK constructor explicitly
  // (`dist/api/openai-responses.js`, `dist/api/anthropic-messages.js`), so the
  // SDK's own readEnv() base-URL fallback is never reached. Probed against pi
  // 0.85.1 with both vars pointed at a dead local listener: both lanes 401'd
  // from the real vendor, not from the listener.
  //
  // So allowVk must be false, and the first reason is credential exposure, not
  // lost data. Gateway mode sets OPENAI_API_KEY to the user's LangWatch virtual
  // key on the premise that the paired base URL points at us. pi ignores that
  // base URL, so it sent our virtual key to api.openai.com, which rejected it
  // and echoed it back in the 401 body — our own credential handed to a third
  // party, once per run. The capture loss rode along on top: the gateway saw
  // nothing, and because the two modes are mutually exclusive (the
  // no-double-trace rule in wrapper-mode.ts), the session-file path was skipped
  // too. Zero capture, no error, a reassuring notice. Setting allowVk false
  // makes wrapper-mode.ts downgrade gateway -> ingestion and say why, exactly
  // as it does for `code`, and the VK is then never placed in pi's child env at
  // all — tool-env.ts has no pi case, and must not regrow one.
  //
  // A redirect IS possible in principle, just not by the mechanism the wrapper
  // uses: langy points pi at the gateway with a generated models.json carrying
  // the baseUrl (`services/langyworker/src/models.ts:105-121`) — a config file,
  // not an environment variable. ADR-132 §7.
  pi: { allowVk: false, allowOtelDirect: true },
};

function hardcodedPolicy(toolSlug: string): PlatformToolPolicy {
  if (toolSlug in PLATFORM_TOOL_POLICIES) {
    return PLATFORM_TOOL_POLICIES[toolSlug as PlatformToolSlug];
  }
  return DEFAULTS;
}

/**
 * Facts about how a tool is BUILT, which no policy row may contradict.
 *
 * Everything else in this file is a policy: a default an organisation is
 * entitled to override, in either direction. These are not. pi's address for
 * every catalog model is compiled into its own build and it reads no base-URL
 * environment variable, so "route pi through the gateway" is not a preference
 * an admin can hold — it is a request the world cannot satisfy.
 *
 * The clamp lives here, at the point of USE, because the layers above it can
 * all be bypassed. The server clamps pi at both of its own sites, so a
 * permissive row cannot be issued today; but `cfg.tool_policies` is a map
 * cached in `~/.langwatch/config.json` at login, and it is trusted
 * unconditionally below. A file written by a client older than this change,
 * or edited by hand, still carries `pi: {allowVk: true}` — and honouring it
 * does not merely pick a dead path. Gateway mode puts the user's LangWatch
 * virtual key in OPENAI_API_KEY, pi ignores the paired base URL and dials
 * api.openai.com, and the vendor echoes the rejected key back in its 401
 * body. So a stale cache would leak our own credential to a third party.
 * Clamping on read makes that unreachable regardless of what the map says.
 *
 * Only structural impossibilities belong here. `code`'s allowVk and cursor's
 * allowOtelDirect are forced server-side and stay policy-shaped on this side;
 * moving them would change behaviour for orgs whose cached rows differ, which
 * is a separate change with its own evidence to gather. ADR-132 §7.
 */
const STRUCTURAL_FORCES: Record<string, Partial<PlatformToolPolicy>> = {
  pi: { allowVk: false },
};

/**
 * Resolve the policy for a given tool slug. Prefers the login-cached
 * server map when it carries an entry for the tool; otherwise falls
 * back to the hardcoded defaults. A non-platform slug (typo) also
 * resolves to DEFAULTS so the wrapper never crashes. Whatever the source,
 * STRUCTURAL_FORCES wins over it.
 */
export function resolvePlatformToolPolicy(
  toolSlug: string,
  cachedPolicies?: PlatformToolPolicyMap,
): PlatformToolPolicy {
  const resolved = cachedPolicies?.[toolSlug] ?? hardcodedPolicy(toolSlug);
  const forced = STRUCTURAL_FORCES[toolSlug];
  return forced ? { ...resolved, ...forced } : resolved;
}
