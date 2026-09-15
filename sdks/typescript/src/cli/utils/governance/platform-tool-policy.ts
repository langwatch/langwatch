/**
 * Platform-tool policy table: per-tool toggles gating the two `langwatch
 * <tool>` routing paths — `allowVk` (gateway via the user's personal VK)
 * and `allowOtelDirect` (OTLP direct with the user's ingestion key). Falls
 * back to these hardcoded defaults when no login-cached policy map exists;
 * keep in sync with the server-side PLATFORM_TOOL_POLICY_DEFAULTS.
 */

export type PlatformToolSlug =
  | "claude"
  | "codex"
  | "gemini"
  | "opencode"
  | "cursor"
  | "copilot"
  | "code";

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
