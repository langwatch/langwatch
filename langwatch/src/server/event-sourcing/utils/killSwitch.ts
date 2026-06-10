import type { createLogger } from "~/utils/logger/server";
import { KILL_SWITCH_CACHE_TTL_MS } from "../../featureFlag/constants";
import type {
  EsKillSwitchKey,
  FeatureFlagKey,
} from "../../featureFlag/registry";
import type { FeatureFlagServiceInterface } from "../../featureFlag/types";
import type { AggregateType } from "../domain/aggregateType";

export type KillSwitchComponentType = "projection" | "mapProjection" | "command";

/**
 * Generates a feature flag key for a component kill switch.
 * Pattern: es-{aggregateType}-{componentType}-{componentName}-killswitch
 *
 * Return type is the typed `EsKillSwitchKey` template literal so callers
 * passing the result to `featureFlagService.isEnabled` satisfy the
 * `FeatureFlagKey` constraint without a cast.
 */
export function generateKillSwitchKey(
  aggregateType: AggregateType,
  componentType: KillSwitchComponentType,
  componentName: string,
): EsKillSwitchKey {
  return `es-${aggregateType}-${componentType}-${componentName}-killswitch`;
}

/**
 * Checks if a component is disabled via feature flag kill switch.
 * Returns true if the component should be disabled.
 */
export async function isComponentDisabled({
  featureFlagService,
  aggregateType,
  componentType,
  componentName,
  tenantId,
  customKey,
  logger,
}: {
  featureFlagService: FeatureFlagServiceInterface | undefined;
  aggregateType: AggregateType;
  componentType: KillSwitchComponentType;
  componentName: string;
  tenantId: string;
  customKey?: FeatureFlagKey;
  logger?: ReturnType<typeof createLogger>;
}): Promise<boolean> {
  if (!featureFlagService) {
    return false;
  }

  const flagKey: FeatureFlagKey =
    customKey ?? generateKillSwitchKey(aggregateType, componentType, componentName);

  try {
    const isDisabled = await featureFlagService.isEnabled(flagKey, {
      distinctId: tenantId,
      defaultValue: false,
      cacheTtlMs: KILL_SWITCH_CACHE_TTL_MS,
    });
    if (isDisabled && logger) {
      logger.debug(
        { componentName, componentType, tenantId, flagKey },
        "Component disabled via feature flag kill switch",
      );
    }
    return isDisabled;
  } catch (error) {
    if (logger) {
      logger.warn(
        { componentName, componentType, tenantId, flagKey, error },
        "Error checking feature flag, defaulting to enabled",
      );
    }
    return false;
  }
}
