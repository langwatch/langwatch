import type { IdIndexFlags } from "@langwatch/clickhouse-client";
import {
  FeatureFlagLatch,
  type FeatureFlagApi,
  idIndexFlagKey,
} from "@langwatch/feature-flag-contract";

/** The owner segment of this module's id-index flags: `clickhouse_id_index_scenario_<target>`. */
export const SCENARIO_ID_INDEX_OWNER = "scenario";

/**
 * Whether this module's id indexes are filled on a ClickHouse target, answered from memory. One
 * latch over the module's own `FeatureFlagApi`, so a lookup by id pays no I/O for the answer.
 */
export class ScenarioIdIndexFlagsService implements IdIndexFlags {
  static create({
    featureFlags,
  }: {
    featureFlags: Pick<FeatureFlagApi, "isEnabled">;
  }): ScenarioIdIndexFlagsService {
    return new ScenarioIdIndexFlagsService(
      new FeatureFlagLatch({ isEnabled: (key) => featureFlags.isEnabled(key, { kind: "system" }) }),
    );
  }

  private constructor(private readonly latch: FeatureFlagLatch) {}

  isOn({ target }: { target: string }): boolean {
    return this.latch.isOn(idIndexFlagKey({ owner: SCENARIO_ID_INDEX_OWNER, target }));
  }
}
