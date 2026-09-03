import { z } from "zod";
import type { FeatureFlagKey } from "./feature-flag";
import { FEATURE_FLAGS } from "./feature-flag";
import { resolveFeatureFlagEnvOverride } from "./feature-flag-environment";

const optionalEnvironmentValueSchema = z.string().optional();

export interface FeatureFlagConfig {
  overrides: ReadonlyMap<string, boolean>;
  forceEnabled: ReadonlySet<string>;
}

export function resolveFeatureFlagConfig(
  source: Readonly<Record<string, unknown>>,
): FeatureFlagConfig {
  const read = (name: string): string | undefined =>
    optionalEnvironmentValueSchema.parse(source[name]);
  const overrides = new Map<FeatureFlagKey, boolean>();

  for (const definition of FEATURE_FLAGS) {
    if ("envOverridable" in definition && definition.envOverridable === false) {
      continue;
    }

    const legacyEnvVar = "legacyEnvVar" in definition ? definition.legacyEnvVar : void 0;

    const value = resolveFeatureFlagEnvOverride({
      read,
      flagKey: definition.key,
      legacyEnvVar,
    });
    if (value !== undefined) {
      overrides.set(definition.key, value);
    }
  }

  const forceEnabled = new Set<FeatureFlagKey>();
  for (const key of read("FEATURE_FLAG_FORCE_ENABLE")?.split(",") ?? []) {
    const trimmed = key.trim();
    if (isFeatureFlagKey(trimmed)) {
      forceEnabled.add(trimmed);
    }
  }

  return { overrides, forceEnabled };
}

function isFeatureFlagKey(value: string): value is FeatureFlagKey {
  return FEATURE_FLAGS.some(({ key }) => key === value);
}
