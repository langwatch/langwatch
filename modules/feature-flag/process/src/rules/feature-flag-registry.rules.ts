import {
  type ExperimentTenantPolicy,
  type FeatureFlagRegistry,
  UnknownFeatureFlagError,
} from "@langwatch/feature-flag-contract";

/** Whether a key names a registered experiment; an unknown key is not one. */
export function isExperimentFlag({
  registry,
  flagKey,
}: {
  registry: FeatureFlagRegistry;
  flagKey: string;
}): boolean {
  try {
    return Boolean(registry.getDefinition(flagKey).experiment);
  } catch (error) {
    if (!(error instanceof UnknownFeatureFlagError)) throw error;
    return false;
  }
}

/** A tenant's stored experiment setting as a policy: no row inherits. */
export function tenantPolicyOf({
  stored,
}: {
  stored: boolean | undefined;
}): ExperimentTenantPolicy {
  if (stored === undefined) {
    return "inherit";
  }

  return stored ? "enabled" : "disabled";
}

/** Whether the registry knows a key; any other lookup failure still throws. */
export function isRegisteredFlag({
  registry,
  flagKey,
}: {
  registry: FeatureFlagRegistry;
  flagKey: string;
}): boolean {
  try {
    registry.getDefinition(flagKey);
    return true;
  } catch (error) {
    if (error instanceof UnknownFeatureFlagError) return false;
    throw error;
  }
}
