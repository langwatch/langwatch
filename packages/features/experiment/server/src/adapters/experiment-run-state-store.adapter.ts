/**
 * The experiment run-state fold store, composed for a process.
 *
 * The store and the ClickHouse repository behind it are both this package's
 * internals; a process needs the store and has no business naming the
 * repository. `platform/app`'s replay runtime was reaching for both by name
 * — and neither was exported, so the module could not load at all — while the
 * line beside it composed Scenario's equivalent through
 * `SimulationRunStateStoreAdapter`. This is that same seam for Experiment.
 */
import type { FoldProjectionStore } from "@langwatch/eventing";
import type {
  ExperimentClickHousePort,
  ExperimentEventingClickHouseClient,
} from "../ports/experiment-clickhouse.port";
import { ExperimentRunStateRepositoryClickHouse } from "../repositories/clickhouse/clickhouse.experiment-run-state.repository";
import { createExperimentRunStateFoldStore } from "../stores/experiment-run-state.store";
import type { ExperimentRunStateData } from "../projections/experiment-run-state.projection";

export class ExperimentRunStateStoreAdapter {
  /**
   * Takes the resolver rather than the port, the way Scenario's adapter does.
   * The process has a `resolveClient` function to hand, and the previous call
   * site passed exactly that where the repository declares an
   * {@link ExperimentClickHousePort} — a bare function has no `resolveClient`
   * on it, so the first read would have thrown.
   */
  static create(options: {
    type: "clickhouse";
    resolveClient: (tenantId: string) => Promise<ExperimentEventingClickHouseClient>;
    defaultRetentionDays: number;
  }): ExperimentRunStateStoreAdapter {
    const clickhouse: ExperimentClickHousePort = { resolveClient: options.resolveClient };
    return new ExperimentRunStateStoreAdapter(
      new ExperimentRunStateRepositoryClickHouse(clickhouse, options.defaultRetentionDays),
    );
  }

  private constructor(private readonly repository: ExperimentRunStateRepositoryClickHouse) {}

  createFoldStore(): FoldProjectionStore<ExperimentRunStateData> {
    return createExperimentRunStateFoldStore(this.repository);
  }
}
