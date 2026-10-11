import type { IdIndexFlags } from "@langwatch/clickhouse-client";
import {
  type FeatureFlagApi,
  FeatureFlagLatch,
  idIndexFlagKey,
} from "@langwatch/feature-flag-contract";

/**
 * Whether Evaluation's id indexes are filled on a ClickHouse target, answered from memory so no
 * lookup pays a flag read (id-index plan §2). The fill step sets the flag this reads.
 */
export class EvaluationIdIndexFlagsService implements IdIndexFlags {
  static create({
    flags,
  }: {
    flags: Pick<FeatureFlagApi, "isEnabled">;
  }): EvaluationIdIndexFlagsService {
    return new EvaluationIdIndexFlagsService(
      new FeatureFlagLatch({ isEnabled: (key) => flags.isEnabled(key, { kind: "system" }) }),
    );
  }

  private constructor(private readonly latch: FeatureFlagLatch) {}

  isOn({ target }: { target: string }): boolean {
    return this.latch.isOn(idIndexFlagKey({ owner: "evaluation", target }));
  }
}
