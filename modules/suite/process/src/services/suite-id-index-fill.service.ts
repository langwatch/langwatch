import type { FillIdIndexesOptions, IdIndexFillReport } from "@langwatch/clickhouse-client";
import type { DataRetentionApi } from "@langwatch/data-retention-contract";

import type { SuiteIdIndexFillRepository } from "../repositories/suite-id-index-fill.repository.ts";

/** What the step hands the fill: where it resumes, whether to write, when to stop. */
type FillRun = Pick<FillIdIndexesOptions, "checkpoint" | "dryRun" | "signal">;

/**
 * Fills the module's id indexes from rows older than their views. Per target, once every index
 * is filled, data-retention raises the index rows to each tenant's retention and only then are
 * the target's marker rows written, so no reader trusts a half-filled index.
 */
export class SuiteIdIndexFillService {
  static create(dependencies: {
    fills: SuiteIdIndexFillRepository;
    retention: Pick<DataRetentionApi, "raiseIdIndexRetention">;
  }): SuiteIdIndexFillService {
    return new SuiteIdIndexFillService(dependencies);
  }

  private constructor(
    private readonly dependencies: {
      fills: SuiteIdIndexFillRepository;
      retention: Pick<DataRetentionApi, "raiseIdIndexRetention">;
    },
  ) {}

  fillIdIndexes(run: FillRun): Promise<IdIndexFillReport> {
    return this.dependencies.fills.fill({
      ...run,
      raiseRetention: (input) => this.dependencies.retention.raiseIdIndexRetention(input),
    });
  }
}
