/**
 * Single opt-in env var that gates the AI Governance preview commands
 * in the unified `langwatch` CLI. Mirrors the web app's
 * `release_ui_ai_governance_enabled` PostHog flag — the long-lived
 * branch carrying governance work merges into main with all new
 * surfaces hidden by default; setting either the env var (CLI) or
 * the PostHog flag (web) opts a session into the preview.
 *
 * Truthy values: "1", "true", "yes", "on" (case-insensitive). Anything
 * else — including empty string and unset — disables the preview so
 * the bare `langwatch` binary keeps its existing behaviour for users
 * who haven't opted in.
 */
const TRUTHY = new Set(["1", "true", "yes", "on"]);

export const GOVERNANCE_PREVIEW_ENV_VAR = "LANGWATCH_GOVERNANCE_PREVIEW";

export function isGovernancePreviewEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = env[GOVERNANCE_PREVIEW_ENV_VAR];
  if (!raw) return false;
  return TRUTHY.has(raw.trim().toLowerCase());
}

/**
 * Stable copy used by error messages + the CLI feature-not-enabled
 * gate. Single string keeps the docs/spec matrix terse.
 */
export const GOVERNANCE_PREVIEW_DISABLED_MESSAGE =
  `AI Governance preview is not enabled. Set ${GOVERNANCE_PREVIEW_ENV_VAR}=1 to opt in. ` +
  `See https://docs.langwatch.ai/ai-gateway/governance/admin-setup`;
