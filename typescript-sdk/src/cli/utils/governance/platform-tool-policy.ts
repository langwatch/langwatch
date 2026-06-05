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
 *     `/api/otel/v1/logs` with the user's ingestion binding token
 *     (Path B). When false, the wrapper refuses to install Path B
 *     and surfaces a clear error.
 *
 * Stage B (per-org overrides): the resolver prefers the policy map
 * the CLI cached at login (`cfg.tool_policies`, served by the
 * control plane's PlatformToolPolicyService) and falls back to the
 * hardcoded defaults below when the cache is absent — an offline or
 * legacy CLI that never cached a map, or a tool the server did not
 * return. The defaults must stay in sync with the server-side
 * PLATFORM_TOOL_POLICY_DEFAULTS.
 */

export type PlatformToolSlug =
  | "claude"
  | "codex"
  | "gemini"
  | "opencode"
  | "cursor";

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
};

function hardcodedPolicy(toolSlug: string): PlatformToolPolicy {
  if (toolSlug in PLATFORM_TOOL_POLICIES) {
    return PLATFORM_TOOL_POLICIES[toolSlug as PlatformToolSlug];
  }
  return DEFAULTS;
}

/**
 * Resolve the policy for a given tool slug. Prefers the login-cached
 * server map when it carries an entry for the tool; otherwise falls
 * back to the hardcoded defaults. A non-platform slug (typo) also
 * resolves to DEFAULTS so the wrapper never crashes.
 */
export function resolvePlatformToolPolicy(
  toolSlug: string,
  cachedPolicies?: PlatformToolPolicyMap,
): PlatformToolPolicy {
  const cached = cachedPolicies?.[toolSlug];
  if (cached) return cached;
  return hardcodedPolicy(toolSlug);
}
