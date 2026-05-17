/**
 * Check if a flag is overridden by environment variable.
 *
 * Auto-derived name: uppercase + dashes-to-underscores. So
 *   release_ui_simulations_menu_enabled → RELEASE_UI_SIMULATIONS_MENU_ENABLED
 *   ops_es_causality_loop_guard_disabled → OPS_ES_CAUSALITY_LOOP_GUARD_DISABLED
 *
 * Optional `legacyEnvVar` lets a flag honor an extra, differently-named
 * env var so installations carrying over an older variable name (e.g.
 * `LANGWATCH_DISABLE_CAUSALITY_LOOP_GUARD`) keep working when the flag
 * is migrated into the registry.
 *
 * Format: `=1` (enabled), `=0` (disabled). Anything else returns
 * undefined so the caller falls through to the next resolution step.
 */
export function checkFlagEnvOverride(
  flagKey: string,
  legacyEnvVar?: string,
): boolean | undefined {
  const envKey = flagKey.toUpperCase().replace(/-/g, "_");
  const primary = parseEnvValue(process.env[envKey]);
  if (primary !== undefined) return primary;

  if (legacyEnvVar) {
    return parseEnvValue(process.env[legacyEnvVar]);
  }
  return undefined;
}

function parseEnvValue(value: string | undefined): boolean | undefined {
  if (value === "1") return true;
  if (value === "0") return false;
  return undefined;
}
