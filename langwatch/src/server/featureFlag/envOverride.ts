/**
 * Check if a flag is overridden by environment variable.
 * Format: FLAG_NAME=1 (enabled) or FLAG_NAME=0 (disabled)
 * Flag name is uppercased with dashes replaced by underscores.
 * Example: release_ui_simulations_menu_enabled -> RELEASE_UI_SIMULATIONS_MENU_ENABLED=1
 */
export function checkFlagEnvOverride(flagKey: string): boolean | undefined {
  const envKey = flagKey.toUpperCase().replace(/-/g, "_");
  const envValue = process.env[envKey];

  if (envValue === "1") return true;
  if (envValue === "0") return false;
  return undefined;
}
