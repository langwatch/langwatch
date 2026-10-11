import type { FillIdIndexesOptions, IdIndexFillReport } from "@langwatch/clickhouse-client";
import type { DataRetentionApi } from "@langwatch/data-retention-contract";

import type { CodingAgentIdIndexFillRepository } from "../repositories/coding-agent-id-index-fill.repository.ts";

/** What the step hands the fill: where it resumes, whether to write, when to stop. */
type FillRun = Pick<FillIdIndexesOptions, "checkpoint" | "dryRun" | "signal">;

/**
 * Fills the module's id indexes from rows older than their views. Per target, once every index
 * is filled, data-retention raises the index rows to each tenant's retention and only then are
 * the target's marker rows written, so no reader trusts a half-filled index.
 */
export class CodingAgentIdIndexFillService {
  static create(dependencies: {
    fills: CodingAgentIdIndexFillRepository;
    retention: Pick<DataRetentionApi, "raiseIdIndexRetention">;
  }): CodingAgentIdIndexFillService {
    return new CodingAgentIdIndexFillService(dependencies);
  }

  private constructor(
    private readonly dependencies: {
      fills: CodingAgentIdIndexFillRepository;
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
