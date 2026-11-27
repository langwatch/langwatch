import { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { BoundApis } from "@langwatch/process";

/** Every channel api-key holds, as the container hands them to the module class. */
export interface ApiKeyChannels {
  /** Asks whether a release flag, `release_braids` among them, is on for a tenant. */
  readonly flags: Pick<FeatureFlagApi, "isEnabled">;
}

/**
 * The live tier binds the flags to feature-flag's API: a binding is not a peer (record §5), so
 * no module feature-flag depends on is asked to depend back on it.
 */
export class BoundApiKeyChannels {
  static readonly requires = [] as const;
  static readonly binds = { flags: FeatureFlagApi } as const;

  static create({ bound }: { bound: BoundApis<typeof BoundApiKeyChannels.binds> }): ApiKeyChannels {
    return { flags: bound.flags };
  }
}
