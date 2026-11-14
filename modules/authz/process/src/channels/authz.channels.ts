import { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { BoundApis } from "@langwatch/process";

/** Every channel authz holds, as the container hands them to the module class. */
export interface AuthzChannels {
  /** Asks whether a release flag, `release_braids` among them, is on for a tenant. */
  readonly flags: Pick<FeatureFlagApi, "isEnabled">;
}

/**
 * The live tier binds the flags to feature-flag's API: a binding is not a peer (record §5), so
 * feature-flag may keep depending on authz without a cycle.
 */
export class BoundAuthzChannels {
  static readonly requires = [] as const;
  static readonly binds = { flags: FeatureFlagApi } as const;

  static create({ bound }: { bound: BoundApis<typeof BoundAuthzChannels.binds> }): AuthzChannels {
    return { flags: bound.flags };
  }
}
