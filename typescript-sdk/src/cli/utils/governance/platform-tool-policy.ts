/**
 * Platform-tool policy table — Stage A.
 *
 * Hardcoded per-tool toggles that gate the two `langwatch <tool>`
 * paths the wrapper can take:
 *
 *   - allowVk: tool may route through the gateway via the user's
 *     personal VK (Path A). When false, the wrapper forces Path B
 *     even if a VK is present.
 *   - allowOtelDirect: tool may route via OTLP straight to
 *     `/api/otel/v1/logs` with the user's ingestion binding token
 *     (Path B). When false, the wrapper refuses to install Path B
 *     and surfaces a clear error.
 *
 * Stage A: defaults are { true, true } for every platform-known
 * tool. No DB row, no admin UI, no network call — the wrapper
 * reads this constant directly. The seam is the resolver function
 * below: Stage B (per-org overrides) replaces the resolver body
 * with a server round-trip without touching any caller.
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

/**
 * Resolve the policy for a given tool slug. Returns DEFAULTS for
 * any non-platform tool — the wrapper's caller already validated
 * that the slug is one of the five known shells, but a default
 * means a typo doesn't crash the wrapper.
 *
 * Stage B will swap this body for a cached server lookup keyed by
 * (organizationId, toolSlug). Callers see no signature change.
 */
export function resolvePlatformToolPolicy(toolSlug: string): PlatformToolPolicy {
  if (toolSlug in PLATFORM_TOOL_POLICIES) {
    return PLATFORM_TOOL_POLICIES[toolSlug as PlatformToolSlug];
  }
  return DEFAULTS;
}
