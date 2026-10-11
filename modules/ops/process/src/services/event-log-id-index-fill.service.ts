import type { FillIdIndexesOptions, IdIndexFillReport } from "@langwatch/clickhouse-client";
import type { DataRetentionApi } from "@langwatch/data-retention-contract";

import type { EventLogIdIndexFillRepository } from "../repositories/event-log-id-index-fill.repository.ts";

/** What the step hands the fill: where it resumes, whether to write, when to stop. */
type FillRun = Pick<FillIdIndexesOptions, "checkpoint" | "dryRun" | "signal">;

/**
 * The `ops:fill-event-log-id-index` step's body: fills the event log's aggregate index from older
 * events, then per ClickHouse target raises its retention and writes its ready marker.
 */
export class EventLogIdIndexFillService {
  static create(dependencies: {
    fills: EventLogIdIndexFillRepository;
    retention: Pick<DataRetentionApi, "raiseIdIndexRetention">;
  }): EventLogIdIndexFillService {
    return new EventLogIdIndexFillService(dependencies);
  }

  private constructor(
    private readonly dependencies: {
      fills: EventLogIdIndexFillRepository;
      retention: Pick<DataRetentionApi, "raiseIdIndexRetention">;
    },
  ) {}

  fill(run: FillRun): Promise<IdIndexFillReport> {
    return this.dependencies.fills.fill({
      ...run,
      raiseRetention: (input) => this.dependencies.retention.raiseIdIndexRetention(input),
    });
  }
}
