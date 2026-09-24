/**
 * The experiment run-state fold store, composed for a process.
 */
import type { FoldProjectionStore } from "@langwatch/eventing";

import type { ExperimentRunStateData } from "../../eventing/experiment-run-state.projection.ts";
import { ExperimentRunStateStore } from "../../eventing/experiment-run-state.store.ts";
import type {
  ExperimentClickHouseRepository,
  ExperimentEventingClickHouseClient,
} from "../experiment-clickhouse.repository.ts";
import { ClickHouseExperimentRunStateRepository } from "./clickhouse.experiment-run-state.repository.ts";

export class ClickhouseExperimentRunStateStoreRepository {
  /**
   * Takes the resolver rather than the client itself, like Scenario's does. A bare function
   * has no `resolveClient` property, so the first read would throw without the resolver.
   */
  static create(options: {
    type: "clickhouse";
    resolveClient: (tenantId: string) => Promise<ExperimentEventingClickHouseClient>;
    defaultRetentionDays: () => number;
  }): ClickhouseExperimentRunStateStoreRepository {
    const clickhouse: ExperimentClickHouseRepository = { resolveClient: options.resolveClient };
    return new ClickhouseExperimentRunStateStoreRepository(
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
