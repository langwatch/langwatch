import { Config, type ConfigOf } from "@langwatch/config";
import { z } from "zod";

import { deriveFeatureFlagEnvVarName } from "./feature-flag-environment.ts";
import { FEATURE_FLAGS, type FeatureFlagDefinition, type FeatureFlagKey } from "./feature-flag.ts";

/** "1" states on, "0" states off; anything else (including absent) states nothing. */
const strictBooleanSchema = z
  .string()
  .optional()
  .transform((value): boolean | undefined => {
    if (value === "1") return true;
    if (value === "0") return false;
    return undefined;
  });

/** Present and not "", "0" or "false" states on; absent states nothing. */
const legacyBooleanSchema = z
  .string()
  .optional()
  .transform((value): boolean | undefined => {
    if (value === undefined) return undefined;
    const normalized = value.trim().toLowerCase();
    if (normalized === "" || normalized === "0" || normalized === "false") return false;
    return true;
  });

/**
 * Forced-on list as comma-separated string; unregistered flags are dropped
 * (list outlives releases).
 */
const forceEnableSchema = z
  .string()
  .optional()
  .transform((value) =>
    (value ?? "")
      .split(",")
      .map((key) => key.trim())
      .filter((key): key is FeatureFlagKey => isFeatureFlagKey(key)),
  );

function isEnvOverridable(definition: FeatureFlagDefinition): boolean {
  return definition.envOverridable !== false;
}

function isFeatureFlagKey(value: string): value is FeatureFlagKey {
  return FEATURE_FLAGS.some(({ key }) => key === value);
}

/**
 * One leaf per registered flag: the env vars are fixed at compile time, so
 * this maps over the static registry. `FeatureFlagApp` assembles the parsed
 * leaves into the service's `Map`/`Set` pair.
 */
export const featureFlagConfig = Config.define((c) => ({
  forceEnable: c.env("FEATURE_FLAG_FORCE_ENABLE", forceEnableSchema),
  overrides: Object.fromEntries(
    FEATURE_FLAGS.filter(isEnvOverridable).map((definition) => [
      definition.key,
      c.env(deriveFeatureFlagEnvVarName(definition.key), strictBooleanSchema),
    ]),
  ),
  legacy: Object.fromEntries(
    FEATURE_FLAGS.flatMap((definition: FeatureFlagDefinition) =>
      definition.legacyEnvVar
        ? ([[definition.key, c.env(definition.legacyEnvVar, legacyBooleanSchema)]] as const)
        : [],
    ),
  ),
}));

export type FeatureFlagServerConfig = ConfigOf<typeof featureFlagConfig>;

export interface FeatureFlagConfig {
  overrides: ReadonlyMap<string, boolean>;
  forceEnabled: ReadonlySet<string>;
}
