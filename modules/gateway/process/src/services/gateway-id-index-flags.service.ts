import type { IdIndexFlags } from "@langwatch/clickhouse-client";
import {
  type FeatureFlagApi,
  type IdIndexFlagKey,
  FeatureFlagLatch,
  idIndexFlagKey,
} from "@langwatch/feature-flag-contract";

/**
 * Whether this module's id indexes are filled on a ClickHouse target, answered from memory. One
 * latch over the module's own `FeatureFlagApi`, so a lookup by id pays no I/O for the answer.
 */
export class GatewayIdIndexFlagsService implements IdIndexFlags {
  static create({
    featureFlags,
  }: {
    featureFlags: Pick<FeatureFlagApi, "isEnabled">;
  }): GatewayIdIndexFlagsService {
    return new GatewayIdIndexFlagsService(
      new FeatureFlagLatch({ isEnabled: (key) => featureFlags.isEnabled(key, { kind: "system" }) }),
    );
  }

  private constructor(private readonly latch: FeatureFlagLatch) {}

  /** The flag the fill turns on for a target, spelt once for the step and the reader. */
  static keyFor({ target }: { target: string }): IdIndexFlagKey {
    return idIndexFlagKey({ owner: "gateway", target });
  }

  isOn({ target }: { target: string }): boolean {
    return this.latch.isOn(GatewayIdIndexFlagsService.keyFor({ target }));
  }
}
