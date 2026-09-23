import { createApiFixture } from "@langwatch/api-fixture";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";

/**
 * Complete flag boundary backed by one switch. Tests that care about a gate
 * drive `enabled`; every other operation on {@link api} refuses by name.
 */
export class TestFeatureFlags {
  enabled = true;

  readonly api: FeatureFlagApi = createApiFixture<FeatureFlagApi>(
    { isEnabled: async (): Promise<boolean> => this.enabled },
    "gateway test flags",
  );
}
