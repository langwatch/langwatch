/**
 * Environment-override resolution for a flag key.
 *
 * Pure: boot supplies the reader while building typed feature-flag config.
 * The running service never reads process environment.
 */

/**
 * Auto-derived variable name: uppercase, dashes to underscores. So
 * `release_ui_ai_gateway_menu_enabled` becomes
 * `RELEASE_UI_AI_GATEWAY_MENU_ENABLED`.
 */
export function deriveFeatureFlagEnvVarName(flagKey: string): string {
  return flagKey.toUpperCase().replace(/-/g, "_");
}

/**
 * Resolve the environment override for a flag, or `undefined` to fall
 * through to the next resolution step.
 *
 * The derived name accepts only `1` and `0`. A `legacyEnvVar` alias keeps
 * the looser truthy semantics of the pre-registry `if (process.env.X)`
 * checks it replaced, so installations carrying an older variable name keep
 * working: `1`/`true`/anything non-empty is on, and empty/`0`/`false` is off.
 */
export function resolveFeatureFlagEnvOverride({
  read,
  flagKey,
  legacyEnvVar,
}: {
  read: (name: string) => string | undefined;
  flagKey: string;
  legacyEnvVar?: string;
}): boolean | undefined {
  const primary = parseStrictEnvValue(read(deriveFeatureFlagEnvVarName(flagKey)));
  if (primary !== undefined) return primary;

  if (legacyEnvVar) {
    return parseLegacyEnvValue(read(legacyEnvVar));
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
  return true;
}
