import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import type { Cluster, Redis } from "ioredis";

import { ClickHouseExperimentDspyRepository } from "../clickhouse/clickhouse.experiment-dspy.repository.ts";
import { ClickHouseExperimentRunProcessingRepository } from "../clickhouse/clickhouse.experiment-run-processing.repository.ts";
import { ClickHouseExperimentRunRepository } from "../clickhouse/clickhouse.experiment-run.repository.ts";
import { ClickHouseExperimentSession } from "../clickhouse/clickhouse.experiment-session.store.ts";
import type { ExperimentRepositories } from "../experiment.repositories.ts";
import {
  type ExperimentPeopleDatabase,
  PrismaExperimentPeopleRepository,
} from "../prisma/prisma.experiment-people.repository.ts";
import {
  type ExperimentWorkflowVersionDatabase,
  PrismaExperimentWorkflowVersionRepository,
} from "../prisma/prisma.experiment-workflow-version.repository.ts";
import {
  type ExperimentDatabase,
  PrismaExperimentRepository,
} from "../prisma/prisma.experiment.repository.ts";
import { RedisExperimentRunAbortRepository } from "../redis/redis.experiment-run-abort.repository.ts";
import { RedisExperimentRunEventStreamRepository } from "../redis/redis.experiment-run-event-stream.repository.ts";
import { RedisExperimentRunFoldRepository } from "../redis/redis.experiment-run-fold.repository.ts";
import { RedisExperimentRunProcessingRepository } from "../redis/redis.experiment-run-processing.repository.ts";

/**
 * Experiment's live stores: experiments and versions in Postgres, runs and DSPy steps in
 * ClickHouse, and a run's plan, folds, stop signal and frames in the Redis every replica shares.
 */
export class LiveExperimentRepositories {
  static readonly requires = ["prisma", "clickhouse", "redis"] as const;

  static create({
    prisma,
    clickhouse,
    redis,
  }: Readonly<{
    prisma: ExperimentDatabase & ExperimentWorkflowVersionDatabase & ExperimentPeopleDatabase;
    clickhouse: ClickHouseQueryClient;
    redis: Redis | Cluster;
  }>): ExperimentRepositories {
    const resolveClient = ClickHouseExperimentSession.resolverOver(clickhouse);
    const telemetry = ClickHouseExperimentRunRepository.loggedTelemetry();
    const folds = RedisExperimentRunFoldRepository.create({ redis });
    const abort = RedisExperimentRunAbortRepository.create({ redis });
    const stream = RedisExperimentRunEventStreamRepository.create({ redis });

    return {
      experiments: PrismaExperimentRepository.create(prisma),
      runHistory: ClickHouseExperimentRunRepository.create({
        workflowVersions: PrismaExperimentWorkflowVersionRepository.create(prisma),
        resolveClient,
        tupleParam: (values) => ClickHouseExperimentRunRepository.tupleParam(values),
        telemetry,
      }),
      dspySteps: ClickHouseExperimentDspyRepository.create({ resolveClient, telemetry }),
      people: PrismaExperimentPeopleRepository.create(prisma),
      runProcessing: {
        open: ({ defaultRetentionDays }) => {
          const cached = RedisExperimentRunProcessingRepository.create({
            resolveClient,
            defaultRetentionDays,
            redis,
          });
          return {
            folds,
            abort,
            stream,
            idLookup: ClickHouseExperimentRunProcessingRepository.create({
              resolveClient,
              clickhouseEnabled: true,
            }).idLookup(),
            experimentRunStateFoldStore: cached.stateFoldStore(),
            experimentRunItemAppendStore: cached.itemStore(),
          };
        },
      },
    };
  }
}
