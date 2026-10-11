import type { IdIndexFlags } from "@langwatch/clickhouse-client";
import {
  type FeatureFlagApi,
  FeatureFlagLatch,
  idIndexFlagKey,
} from "@langwatch/feature-flag-contract";

/** The owner trace's id-index flags are keyed by: `clickhouse_id_index_trace_<target>`. */
export const TRACE_ID_INDEX_OWNER = "trace";

/**
 * Whether trace's id indexes are filled on a ClickHouse target, answered from memory: a latch
 * over trace's own feature flags, so no lookup waits on a flag read (id-index plan §2).
 */
export class TraceIdIndexFlagsService implements IdIndexFlags {
  private constructor(private readonly latch: FeatureFlagLatch) {}

  static create({ featureFlags }: { featureFlags: FeatureFlagApi }): TraceIdIndexFlagsService {
    return new TraceIdIndexFlagsService(
      new FeatureFlagLatch({
        isEnabled: (key) => featureFlags.isEnabled(key, { kind: "system" }),
      }),
    );
  }

  isOn({ target }: { target: string }): boolean {
    return this.latch.isOn(idIndexFlagKey({ owner: TRACE_ID_INDEX_OWNER, target }));
  }
}
