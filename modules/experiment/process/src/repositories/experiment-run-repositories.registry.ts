import type { MembersRead } from "@langwatch/process-stores/members";

import { ExperimentRunStateStore } from "../eventing/experiment-run-state.store.ts";
import { ClickHouseExperimentRunProcessingRepository } from "./clickhouse/clickhouse.experiment-run-processing.repository.ts";
import type { ExperimentEventingClickHouseResolver } from "./experiment-clickhouse.repository.ts";
import type { ExperimentRunRepositories } from "./experiment-run.repositories.ts";
import { MemoryExperimentRunAbortRepository } from "./memory/memory.experiment-run-abort.repository.ts";
import { MemoryExperimentRunFoldRepository } from "./memory/memory.experiment-run-fold.repository.ts";
import { RedisExperimentRunAbortRepository } from "./redis/redis.experiment-run-abort.repository.ts";
import { RedisExperimentRunFoldRepository } from "./redis/redis.experiment-run-fold.repository.ts";
import { RedisExperimentRunProcessingRepository } from "./redis/redis.experiment-run-processing.repository.ts";

type RunStores = Readonly<{
  resolveClient: ExperimentEventingClickHouseResolver;
  defaultRetentionDays: () => number;
}>;

/**
 * `shared` goes through Redis so every replica reads one plan and the run-state fold is cached;
 * `local` is for a deployment with no Redis, whose runs are refused at start anyway.
 */
export const experimentRunRepositories = {
  shared: {
    create(
      input: RunStores & Readonly<{ redis: NonNullable<MembersRead<readonly ["redis"]>["redis"]> }>,
    ): ExperimentRunRepositories {
      const { redis, resolveClient, defaultRetentionDays } = input;
      const cached = RedisExperimentRunProcessingRepository.create({
        resolveClient,
        defaultRetentionDays,
        redis,
      });
      return {
        folds: RedisExperimentRunFoldRepository.create({ redis }),
        abort: RedisExperimentRunAbortRepository.create({ redis }),
        idLookup: ClickHouseExperimentRunProcessingRepository.create({
          resolveClient,
          clickhouseEnabled: true,
        }).idLookup(),
        experimentRunStateFoldStore: cached.stateFoldStore(),
        experimentRunItemAppendStore: cached.itemStore(),
      };
    },
  },
  local: {
    create(input: RunStores): ExperimentRunRepositories {
      const { resolveClient, defaultRetentionDays } = input;
      const eventing = ClickHouseExperimentRunProcessingRepository.create({
        resolveClient,
        clickhouseEnabled: true,
      });
      return {
        folds: MemoryExperimentRunFoldRepository.create(),
        abort: MemoryExperimentRunAbortRepository.create(),
        idLookup: eventing.idLookup(),
        experimentRunStateFoldStore: ExperimentRunStateStore.create({
          repository: eventing.stateRepository({ defaultRetentionDays }),
        }),
        experimentRunItemAppendStore: eventing.itemStore({ defaultRetentionDays }),
      };
    },
  },
};
