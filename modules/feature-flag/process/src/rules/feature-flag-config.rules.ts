import {
  FEATURE_FLAGS,
  type FeatureFlagConfig,
  type FeatureFlagDefinition,
  type FeatureFlagKey,
  type FeatureFlagServerConfig,
} from "@langwatch/feature-flag-contract";

function isEnvOverridable(definition: FeatureFlagDefinition): boolean {
  return definition.envOverridable !== false;
}

/**
 * Turns the parsed slice's per-flag leaves into the service's `Map`/`Set`
 * pair: the derived variable wins where it states one, the legacy alias
 * only where it does not.
 */
export function assembleFeatureFlagConfig(config: FeatureFlagServerConfig): FeatureFlagConfig {
  const overrides = new Map<FeatureFlagKey, boolean>();
  for (const definition of FEATURE_FLAGS) {
    if (!isEnvOverridable(definition)) continue;
    const value = config.overrides[definition.key] ?? config.legacy[definition.key];
    if (value !== undefined) overrides.set(definition.key, value);
  }

  return {
    overrides,
    forceEnabled: new Set<FeatureFlagKey>(config.forceEnable),
    isSaas: config.isSaas,
  };
}

/** The registry default this deployment resolves to when nothing overrides the flag. */
export function deploymentDefaultOf({
  definition,
  isSaas,
}: {
  definition: Pick<FeatureFlagDefinition, "defaultValue" | "selfHostedDefaultValue">;
  isSaas: boolean;
}): boolean {
  if (isSaas) return definition.defaultValue;
  return definition.selfHostedDefaultValue ?? definition.defaultValue;
}
