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
 * at sdks/typescript/src/cli/utils/governance/platform-tool-policy.ts for the
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
  "copilot",
  "code",
  "pi",
] as const;

export type PlatformToolSlug = (typeof PLATFORM_TOOL_SLUGS)[number];

export interface PlatformToolPolicy {
  allowVk: boolean;
  allowOtelDirect: boolean;
}

export type PlatformToolPolicyMap = Record<
  PlatformToolSlug,
  PlatformToolPolicy
>;

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
  // GitHub Copilot CLI (>= 1.0.41): native OTel export + BYOK gateway
  // env vars, so both paths are real. ADR-039.
  copilot: { allowVk: true, allowOtelDirect: true },
  // `code` (VS Code Copilot Chat) is ingestion-only: the chat extension has
  // native OTel export but no BYOK gateway env, so Path A is structurally
  // impossible. Inverse of cursor. ADR-039 §Extension #2. allowVk stays
  // false regardless of tile config (forced, like cursor's allowOtelDirect).
  code: { allowVk: false, allowOtelDirect: true },
  // pi is ingestion-only, for the inverse reason to cursor's. It emits no
  // telemetry of its own, so Path B is the launcher reading pi's session file
  // and posting it under the personal ingestion key. Path A is structurally
  // impossible: pi hardcodes each catalog model's base URL and ignores
  // OPENAI_BASE_URL / ANTHROPIC_BASE_URL. Every model in
  // `@earendil-works/pi-ai`'s models.generated.js carries a literal `baseUrl`,
  // and both client factories pass it to the vendor SDK constructor
  // explicitly, so the SDK's readEnv() fallback is never reached (probed
  // against pi 0.85.1: with both vars pointed at a dead local listener, both
  // lanes 401'd from the real vendor). Left allowVk true, a member with a
  // personal virtual key resolved to the gateway, pi dialled the vendor
  // anyway, and the mutually exclusive session-file path was skipped — silent
  // total data loss. Worse than loss, in fact: gateway mode puts the member's
  // LangWatch virtual key in OPENAI_API_KEY, so pi presented OUR credential to
  // api.openai.com, which rejected it and echoed it back in the 401 body. That
  // is the reason this entry is not merely a capture preference. A redirect is
  // possible by config file rather than env
  // (langy writes pi a generated models.json,
  // `services/langyworker/src/models.ts:105-121`), which is not the mechanism
  // the launcher uses. allowVk stays false regardless of tile config, like
  // `code`. ADR-132 §7.
  pi: { allowVk: false, allowOtelDirect: true },
};

export function isPlatformToolSlug(slug: string): slug is PlatformToolSlug {
  return (PLATFORM_TOOL_SLUGS as readonly string[]).includes(slug);
}

/**
 * The ingest `source_type` a wrapped tool stamps, read back to its CLI slug.
 * Mirrors SOURCE_TYPE_BY_TOOL in
 * sdks/typescript/src/cli/utils/governance/otel-env-block.ts, which is the
 * only writer of these values on the direct-OTLP path.
 *
 * Deliberately partial, and the mint route treats an unmapped source type as
 * ungoverned: `cursor` and `copilot_app` have no direct-OTLP wiring to gate,
 * and an SDK or a template mints under source types that no per-tool policy
 * describes.
 */
export const PLATFORM_TOOL_SLUG_BY_SOURCE_TYPE: Readonly<
  Record<string, PlatformToolSlug>
> = {
  claude_code: "claude",
  codex: "codex",
  gemini: "gemini",
  opencode: "opencode",
  copilot_cli: "copilot",
  copilot_vscode: "code",
  // pi stamps a bare `pi` source type (SOURCE_TYPE_BY_TOOL in the launcher's
  // otel-env-block.ts). It has to be here and not only in the two tables
  // above: an unmapped source type leaves `policedSlug` undefined at
  // auth-cli.ts:2582, the allowOtelDirect branch sits inside
  // `if (policedSlug)`, and the mint silently proceeds — so an organisation
  // that switched pi's direct path off would still be issued a key.
  // ADR-132 §7.
  pi: "pi",
};
