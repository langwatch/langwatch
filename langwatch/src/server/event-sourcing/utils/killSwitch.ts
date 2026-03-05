import type { createLogger } from "~/utils/logger/server";
import type { FeatureFlagServiceInterface } from "../../featureFlag/types";
import type { AggregateType } from "../domain/aggregateType";

/**
 * Generates a feature flag key for a component kill switch.
 * Pattern: es-{aggregateType}-{componentType}-{componentName}-killswitch
 */
export function generateKillSwitchKey(
  aggregateType: AggregateType,
  componentType: "projection" | "mapProjection" | "command",
  componentName: string,
): string {
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
  componentType: "projection" | "mapProjection" | "command";
  componentName: string;
  tenantId: string;
  customKey?: string;
  logger?: ReturnType<typeof createLogger>;
}): Promise<boolean> {
  if (!featureFlagService) {
    return false;
  }

  const flagKey =
    customKey ?? generateKillSwitchKey(aggregateType, componentType, componentName);

  try {
    const isDisabled = await featureFlagService.isEnabled(
      flagKey,
      tenantId,
      false,
    );
    if (isDisabled && logger) {
      logger.info(
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
