import type { IdIndexFlags } from "@langwatch/clickhouse-client";
import {
  FeatureFlagLatch,
  type FeatureFlagApi,
  idIndexFlagKey,
} from "@langwatch/feature-flag-contract";

/** The owner segment of this module's id-index flags: `clickhouse_id_index_suite_<target>`. */
export const SUITE_ID_INDEX_OWNER = "suite";

/**
 * Whether this module's id indexes are filled on a ClickHouse target, answered from memory. One
 * latch over the module's own `FeatureFlagApi`, so a lookup by id pays no I/O for the answer.
 */
export class SuiteIdIndexFlagsService implements IdIndexFlags {
  static create({
    featureFlags,
  }: {
    featureFlags: Pick<FeatureFlagApi, "isEnabled">;
  }): SuiteIdIndexFlagsService {
    return new SuiteIdIndexFlagsService(
      new FeatureFlagLatch({ isEnabled: (key) => featureFlags.isEnabled(key, { kind: "system" }) }),
    );
  }

  private constructor(private readonly latch: FeatureFlagLatch) {}

  isOn({ target }: { target: string }): boolean {
    return this.latch.isOn(idIndexFlagKey({ owner: SUITE_ID_INDEX_OWNER, target }));
  }
}
