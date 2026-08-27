import { z } from "zod";
import {
  FEATURE_FLAG_FAMILIES,
  FEATURE_FLAGS,
  type FeatureFlagDefinition,
  type FeatureFlagFamily,
} from "./feature-flag";
import {
  findExperimentDefinitionViolations,
  type FeatureFlagExperiment,
} from "./feature-flag-experiment";
import { FRONTEND_FEATURE_FLAGS, type FrontendFeatureFlag } from "./frontend-feature-flags";
import { PUBLIC_ANONYMOUS_FEATURE_FLAGS } from "./public-anonymous-feature-flags";

export interface RegisteredExperiment {
  key: FrontendFeatureFlag;
  experiment: FeatureFlagExperiment;
}

/**
 * The flag vocabulary a service resolves against.
 *
 * Injected rather than imported so a test can supply its own definitions
 * instead of mutating the shipped registry, and so the validation below runs
 * over whatever vocabulary is actually in use.
 */
export interface FeatureFlagRegistry {
  readonly definitions: readonly FeatureFlagDefinition[];
  readonly families: readonly FeatureFlagFamily[];
  readonly browserVisibleKeys: readonly FrontendFeatureFlag[];
  readonly publicAnonymousKeys: readonly FrontendFeatureFlag[];
  /**
   * Exhaustive over THIS registry's browser-visible keys, not the shipped
   * constant, so a service built on a different vocabulary validates against
   * the vocabulary it is actually using.
   */
  readonly frontendMapSchema: z.ZodType<Record<FrontendFeatureFlag, boolean>>;
  resolve(key: string): FeatureFlagDefinition | undefined;
  experiments(): readonly RegisteredExperiment[];
}

/**
 * Build a registry, refusing an invalid experiment definition outright.
 *
 * Validation lives here rather than at module scope so it covers every
 * vocabulary, including one a test builds, and so the failure names the
 * offending flag instead of appearing as an unrelated import error.
 */
export function createFeatureFlagRegistry({
  definitions,
  families = [],
  browserVisibleKeys,
  publicAnonymousKeys = [],
}: {
  definitions: readonly FeatureFlagDefinition[];
  families?: readonly FeatureFlagFamily[];
  browserVisibleKeys: readonly FrontendFeatureFlag[];
  publicAnonymousKeys?: readonly FrontendFeatureFlag[];
}): FeatureFlagRegistry {
  const violations = findExperimentDefinitionViolations({
    definitions,
    browserVisibleKeys,
    publicAnonymousKeys,
  });
  if (violations.length > 0) {
    throw new Error(`Invalid feature flag experiment definitions:\n${violations.join("\n")}`);
  }

  const byKey = new Map(definitions.map((definition) => [definition.key, definition]));
  const experiments = definitions.flatMap((definition) => {
    const key = browserVisibleKeys.find((candidate) => candidate === definition.key);

    return definition.experiment && key ? [{ key, experiment: definition.experiment }] : [];
  });

  const frontendMapSchema = z.record(
    z.enum(browserVisibleKeys as [FrontendFeatureFlag, ...FrontendFeatureFlag[]]),
    z.boolean(),
  );

  return {
    definitions,
    families,
    browserVisibleKeys,
    publicAnonymousKeys,
    frontendMapSchema,
    resolve(key: string): FeatureFlagDefinition | undefined {
      const explicit = byKey.get(key);
      if (explicit) return explicit;

      for (const family of families) {
        if (!key.startsWith(family.keyPrefix)) continue;
        if (family.keySuffix && !key.endsWith(family.keySuffix)) continue;

        return {
          key,
          scope: family.scope,
          defaultValue: family.defaultValue,
          description: family.description,
          family: family.family,
        };
      }

      return undefined;
    },
    experiments: () => experiments,
  };
}

/** The vocabulary the application ships. */
export const FEATURE_FLAG_REGISTRY: FeatureFlagRegistry = createFeatureFlagRegistry({
  definitions: FEATURE_FLAGS,
  families: FEATURE_FLAG_FAMILIES,
  browserVisibleKeys: FRONTEND_FEATURE_FLAGS,
  publicAnonymousKeys: PUBLIC_ANONYMOUS_FEATURE_FLAGS,
});
