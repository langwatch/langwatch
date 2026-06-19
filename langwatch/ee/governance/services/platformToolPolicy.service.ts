// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Per-tool CLI path policy - canonical wire shape + hardcoded defaults.
 *
 * The login `toolPolicies` map tells the `langwatch <tool>` wrapper which
 * routes a tool may use:
 *
 *   - allowVk: route through the gateway via the user's personal virtual key
 *     (Path A).
 *   - allowOtelDirect: route via direct OTLP to the personal ingestion
 *     endpoint (Path B).
 *
 * The standalone PlatformToolPolicy table + admin "CLI Paths" tab were
 * retired: the per-tool policy now lives in each org's coding_assistant tile
 * config (config.allowVk / config.allowOtelDirect). cliBootstrap derives the
 * map from those tiles via {@link AiToolEntryService.resolveToolPolicyOverrides},
 * merged over the defaults below - a tool with no tile keeps its default, so a
 * fresh org behaves exactly as before. The CLI mirror of these defaults lives
 * at typescript-sdk/src/cli/utils/governance/platform-tool-policy.ts for the
 * offline / legacy fallback; the two tables must stay in sync.
 *
 * The Prisma `PlatformToolPolicy` model is intentionally kept (non-destructive
 * retirement) but no longer read or written by the app.
 */

export const PLATFORM_TOOL_SLUGS = [
  "claude",
  "codex",
  "gemini",
  "opencode",
  "cursor",
] as const;

export type PlatformToolSlug = (typeof PLATFORM_TOOL_SLUGS)[number];

export interface PlatformToolPolicy {
  allowVk: boolean;
  allowOtelDirect: boolean;
}

export type PlatformToolPolicyMap = Record<PlatformToolSlug, PlatformToolPolicy>;

/**
 * Hardcoded defaults. claude/codex/gemini/opencode allow both paths; cursor is
 * GUI-only so Path B (a terminal OTLP env) never reaches the agent panel, so it
 * allows the gateway path only.
 */
export const PLATFORM_TOOL_POLICY_DEFAULTS: Record<
  PlatformToolSlug,
  PlatformToolPolicy
> = {
  claude: { allowVk: true, allowOtelDirect: true },
  codex: { allowVk: true, allowOtelDirect: true },
  gemini: { allowVk: true, allowOtelDirect: true },
  opencode: { allowVk: true, allowOtelDirect: true },
  cursor: { allowVk: true, allowOtelDirect: false },
};

export function isPlatformToolSlug(slug: string): slug is PlatformToolSlug {
  return (PLATFORM_TOOL_SLUGS as readonly string[]).includes(slug);
}
