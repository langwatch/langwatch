import type { AppendStore } from "@langwatch/eventing";

import { ExperimentRunItemStore } from "../../eventing/experiment-run-item.store.ts";
import type { ClickHouseExperimentRunResultRecord } from "../../eventing/experiment-run-result-storage.projection.ts";
import type { ExperimentRunStateData } from "../../eventing/experiment-run-state.projection.ts";
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

export type ExperimentRunEventingStateRepository = ExperimentRunStateRepository;
export type ExperimentRunEventingIdLookup = ExperimentIdLookupRepository;
export type ExperimentRunEventingResultRecord = ClickHouseExperimentRunResultRecord;
export type ExperimentRunEventingState = ExperimentRunStateData;

/**
 * The Eventing side of experiment run processing: the storage this feature's
 * pipeline reads and writes through.
 */
export class ClickHouseExperimentRunProcessingRepository {
  private constructor(private readonly clickhouse: ExperimentClickHouseRepository | null) {}

  static create(input: {
    resolveClient: ExperimentEventingClickHouseResolver;
    clickhouseEnabled: boolean;
  }): ClickHouseExperimentRunProcessingRepository {
    return new ClickHouseExperimentRunProcessingRepository(
      input.clickhouseEnabled
        ? ClickhouseExperimentClickHouseRepository.create(input.resolveClient)
        : null,
    );
  }

  stateRepository(input: { defaultRetentionDays: () => number }): ExperimentRunStateRepository {
    return this.clickhouse
      ? ClickHouseExperimentRunStateRepository.create({
          clickhouse: this.clickhouse,
          defaultRetentionDays: input.defaultRetentionDays,
        })
      : MemoryExperimentRunStateRepository.create();
  }

  idLookup(): ExperimentIdLookupRepository {
    return this.clickhouse
      ? ClickHouseExperimentIdLookupRepository.create({ clickhouse: this.clickhouse })
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
