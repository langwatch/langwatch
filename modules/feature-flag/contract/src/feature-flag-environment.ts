/**
 * Environment-override resolution for a flag key. Pure: boot supplies the
 * reader while building typed feature-flag config — the running service
 * never reads process environment.
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
 * Resolve the environment override for a flag; legacy env var keeps
 * backward compatibility with older truthy semantics.
 */
export function parseFeatureFlagEnvOverride({
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
