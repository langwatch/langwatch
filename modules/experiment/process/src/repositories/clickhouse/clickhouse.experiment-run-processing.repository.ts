import type { IdIndexFlags } from "@langwatch/clickhouse-client";
import type { AppendStore } from "@langwatch/eventing";

import { ExperimentRunItemStore } from "../../eventing/experiment-run-item.store.ts";
import type { ClickHouseExperimentRunResultRecord } from "../../eventing/experiment-run-result-storage.projection.ts";
import type {
  ExperimentClickHouseRepository,
  ExperimentEventingClickHouseResolver,
} from "../experiment-clickhouse.repository.ts";
import type { ExperimentIdLookupRepository } from "../experiment-id-lookup.repository.ts";
import type { ExperimentRunStateRepository } from "../experiment-run-state.repository.ts";
import { MemoryExperimentIdLookupRepository } from "../memory/memory.experiment-id-lookup.repository.ts";
import { MemoryExperimentRunStateRepository } from "../memory/memory.experiment-run-state.repository.ts";
import { ClickhouseExperimentClickHouseRepository } from "./clickhouse.experiment-clickhouse.repository.ts";
import { ClickHouseExperimentIdLookupRepository } from "./clickhouse.experiment-id-lookup.repository.ts";
import { ClickHouseExperimentRunStateRepository } from "./clickhouse.experiment-run-state.repository.ts";

/**
 * The Eventing side of experiment run processing: the storage this feature's
 * pipeline reads and writes through.
 */
export class ClickHouseExperimentRunProcessingRepository {
  private constructor(
    private readonly clickhouse: ExperimentClickHouseRepository | null,
    private readonly idIndex: IdIndexFlags | undefined,
  ) {}

  static create(input: {
    resolveClient: ExperimentEventingClickHouseResolver;
    clickhouseEnabled: boolean;
    /** The module's id-index flags; absent reads runs with no time bound, as before. */
    idIndex?: IdIndexFlags | undefined;
  }): ClickHouseExperimentRunProcessingRepository {
    return new ClickHouseExperimentRunProcessingRepository(
      input.clickhouseEnabled
        ? ClickhouseExperimentClickHouseRepository.create(input.resolveClient)
        : null,
      input.idIndex,
    );
  }

  stateRepository(input: { defaultRetentionDays: () => number }): ExperimentRunStateRepository {
    return this.clickhouse
      ? ClickHouseExperimentRunStateRepository.create({
          clickhouse: this.clickhouse,
          defaultRetentionDays: input.defaultRetentionDays,
          idIndex: this.idIndex,
        })
      : MemoryExperimentRunStateRepository.create();
  }

  idLookup(): ExperimentIdLookupRepository {
    return this.clickhouse
      ? ClickHouseExperimentIdLookupRepository.create({
          clickhouse: this.clickhouse,
          idIndex: this.idIndex,
        })
      : MemoryExperimentIdLookupRepository.create();
  }

  itemStore(input: {
    defaultRetentionDays: () => number;
  }): AppendStore<ClickHouseExperimentRunResultRecord> {
    return ExperimentRunItemStore.create({
      clickhouse: this.clickhouse,
      defaultRetentionDays: input.defaultRetentionDays,
    });
  }
}
