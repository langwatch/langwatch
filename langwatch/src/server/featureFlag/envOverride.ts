/**
 * Check if a flag is overridden by environment variable.
 *
 * Auto-derived name: uppercase + dashes-to-underscores. So
 *   release_ui_simulations_menu_enabled -> RELEASE_UI_SIMULATIONS_MENU_ENABLED
 *   ops_es_causality_loop_guard_disabled -> OPS_ES_CAUSALITY_LOOP_GUARD_DISABLED
 *
 * Optional `legacyEnvVar` lets a flag honor an extra, differently-named
 * env var so installations carrying over an older variable name (e.g.
 * `LANGWATCH_DISABLE_CAUSALITY_LOOP_GUARD`, `DISABLE_PII_REDACTION`)
 * keep working when the flag is migrated into the registry.
 *
 * Primary env key accepts only `=1` (true) or `=0` (false). Anything
 * else returns undefined so the caller falls through to the next
 * resolution step.
 *
 * Legacy aliases use a looser truthy semantic that matches the
 * pre-registry behaviour where most of these were checked as
 * `if (process.env.DISABLE_PII_REDACTION)`. Accepts 1/true (case
 * insensitive) as on; 0/false/empty/unset as off.
 */
export function checkFlagEnvOverride(
  flagKey: string,
  legacyEnvVar?: string,
): boolean | undefined {
  const envKey = flagKey.toUpperCase().replace(/-/g, "_");
  const primary = parseStrictEnvValue(process.env[envKey]);
  if (primary !== undefined) return primary;

  if (legacyEnvVar) {
    return parseLegacyEnvValue(process.env[legacyEnvVar]);
  }
  return undefined;
}

function parseStrictEnvValue(value: string | undefined): boolean | undefined {
  if (value === "1") return true;
  if (value === "0") return false;
  return undefined;
}

function parseLegacyEnvValue(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "" || normalized === "0" || normalized === "false") {
    return false;
  }
  // Any other truthy string (1, true, yes, anything) honored as on to
  // match the pre-registry `if (process.env.X)` truthy check semantics.
  return true;
}
