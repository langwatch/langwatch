import {
  resolveEffectiveForListing,
  type FeatureFlagConfig,
  type FeatureFlagRegistry,
  type OperatorFeatureFlagCatalogue,
  type StoredFeatureFlag,
} from "@langwatch/feature-flag-contract";
import { toDate } from "@langwatch/time";

import { deploymentDefaultOf } from "./feature-flag-config.rules.ts";

/** The operator listing: each registered flag, then each stored row the registry dropped. */
export function operatorCatalogueOf({
  registry,
  stored,
  config,
}: {
  registry: FeatureFlagRegistry;
  stored: readonly StoredFeatureFlag[];
  config: FeatureFlagConfig;
}): OperatorFeatureFlagCatalogue {
  const registeredKeys = new Set(registry.definitions.map(({ key }) => key));
  const flags = registry.definitions.map((definition) => {
    const row = stored.find(({ key }) => key === definition.key);
    const envOverride = config.overrides.get(definition.key) ?? null;
    const defaultValue = deploymentDefaultOf({ definition, isSaas: config.isSaas });

    return {
      key: definition.key,
      scope: definition.scope,
      defaultValue,
      description: definition.description,
      family: definition.family ?? null,
      storedValue: row?.enabled ?? null,
      rules: row?.rules ?? [],
      envOverride,
      effective: resolveEffectiveForListing({
        envOverride,
        rules: row?.rules ?? [],
        rowEnabled: row?.enabled ?? null,
        registryDefault: defaultValue,
      }),
      lastEditedBy: row?.lastEditedBy ?? null,
      updatedAt: row?.updatedAt ? toDate(row.updatedAt) : null,
    };
  });
  const orphaned = stored
    .filter(({ key }) => !registeredKeys.has(key))
    .map((row) => ({
      key: row.key,
      scope: "SYSTEM" as const,
      defaultValue: false,
      description: "Orphaned postgres flag row (no longer registered).",
      family: null,
      storedValue: row.enabled,
      rules: row.rules,
      envOverride: null,
      effective: resolveEffectiveForListing({
        envOverride: null,
        rules: row.rules,
        rowEnabled: row.enabled,
        registryDefault: false,
      }),
      lastEditedBy: row.lastEditedBy,
      updatedAt: toDate(row.updatedAt),
    }));

  return {
    flags: [...flags, ...orphaned],
    families: registry.families.map((family) => ({
      family: family.family,
      keyPrefix: family.keyPrefix,
      scope: family.scope,
      defaultValue: family.defaultValue,
      description: family.description,
    })),
  };
}
