/**
 * The experiment run-state fold store, composed for a process.
 */
import type { FoldProjectionStore } from "@langwatch/eventing";
import type {
  ExperimentClickHousePort,
  ExperimentEventingClickHouseClient,
} from "../ports/experiment-clickhouse.port";
import { ClickHouseExperimentRunStateRepository } from "../repositories/clickhouse/clickhouse.experiment-run-state.repository";
import { ExperimentRunStateStore } from "../stores/eventing/eventing.experiment-run-state.store";
import type { ExperimentRunStateData } from "../projections/experiment-run-state.projection";

export class ExperimentRunStateStoreAdapter {
  /**
   * Takes the resolver rather than the port, the way Scenario's adapter does. The process has a `resolveClient`
   * function to hand, and the previous call site passed exactly that where the repository declares an {@link
   * ExperimentClickHousePort} — a bare function has no `resolveClient` on it, so the first read would have thrown.
   */
  static create(options: {
    type: "clickhouse";
    resolveClient: (tenantId: string) => Promise<ExperimentEventingClickHouseClient>;
    defaultRetentionDays: number;
  }): ExperimentRunStateStoreAdapter {
    const clickhouse: ExperimentClickHousePort = { resolveClient: options.resolveClient };
    return new ExperimentRunStateStoreAdapter(
      ClickHouseExperimentRunStateRepository.create({
        clickhouse,
        defaultRetentionDays: options.defaultRetentionDays,
      }),
    );
  }

  private constructor(private readonly repository: ClickHouseExperimentRunStateRepository) {}

  createFoldStore(): FoldProjectionStore<ExperimentRunStateData> {
    return ExperimentRunStateStore.create({ repository: this.repository });
  }
}
