import { z } from "zod";
import type { FeatureFlagKey } from "./feature-flag.ts";
import { FEATURE_FLAGS } from "./feature-flag.ts";
import { resolveFeatureFlagEnvOverride } from "./feature-flag-environment.ts";

const optionalEnvironmentValueSchema = z.string().optional();

/**
 * Forced-on list as comma-separated string; unregistered flags are dropped
 * (list outlives releases).
 */
export const featureFlagServerConfigSchema = z
  .string()
  .optional()
  .transform((value) =>
    (value ?? "")
      .split(",")
      .map((key) => key.trim())
      .filter((key): key is FeatureFlagKey => isFeatureFlagKey(key)),
  );

export type FeatureFlagServerConfig = z.infer<typeof featureFlagServerConfigSchema>;

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

  const forceEnabled = new Set<FeatureFlagKey>(
    featureFlagServerConfigSchema.parse(read("FEATURE_FLAG_FORCE_ENABLE")),
  );

  return { overrides, forceEnabled };
}

function isFeatureFlagKey(value: string): value is FeatureFlagKey {
  return FEATURE_FLAGS.some(({ key }) => key === value);
}
