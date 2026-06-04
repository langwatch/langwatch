// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Custom-tool OTTL surface.
 *
 * The platform-known tools (claude_code, codex, gemini, opencode) lift
 * model + tokens + cost + thread.id natively in TS extractors at fold
 * time (see foldProjection.handleTraceLogRecordReceived). Admins cannot
 * modify those, so they no longer expose an OTTL editor or starter
 * template. The OTTL editor stays alive only for `otel_generic`, the
 * custom-slug catch-all where admins do paste their own statements.
 */

export const OTTL_ENABLED_SOURCE_TYPES: readonly string[] = ["otel_generic"];

export function getStarterTemplate(_sourceType: string): readonly string[] {
  return [];
}

export function isOttlEnabledSourceType(sourceType: string): boolean {
  return OTTL_ENABLED_SOURCE_TYPES.includes(sourceType);
}
