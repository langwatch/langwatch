import type { ProcessStore } from "@langwatch/eventing";
import { EventSourcing } from "@langwatch/eventing";
import type { StateProjectionStore } from "@langwatch/eventing";
import type { TopicApi, TopicClusteringModels } from "@langwatch/topic-contract";
import { type AssignTopicCommandData, TraceTopicAssignment } from "@langwatch/trace-contract";
import type { Cluster, Redis } from "ioredis";
import {
  EventingTopicClusteringCommandsAdapter,
  EventingTopicClusteringOutcomeCommandsAdapter,
} from "../../services/topic-clustering-commands.service.ts";
import { EventingTopicClusteringScheduleAdapter } from "../../services/topic-clustering-schedule.service.ts";
import {
  createTopicClusteringProcessingPipeline,
  type TopicClusteringProcessingPipelineDeps,
} from "../../services/topic-clustering-eventing.service.ts";
import { RedisTopicClusteringBootstrapRepository } from "../redis/redis.topic-clustering-bootstrap.repository.ts";
import {
  classifyClusteringError,
  type TopicClusteringMetrics,
  type TopicClusteringRun,
} from "../../intents/topic-clustering.intent.ts";
import {
  TopicClusteringRunner,
  type TopicClusteringRunnerDeps,
} from "../../intents/topic-clustering-runner.intent.ts";
import { LegacyImportTopicClusteringMigration } from "../../migrations/legacy-import.topic-clustering.migration.ts";
import type { TopicClusteringClickHouseResolver } from "../../app/topic.infrastructure.ts";
import type {
  TopicClusteringLangevalsKind,
  TopicClusteringLangevals,
} from "../../app/topic.infrastructure.ts";
import type { TopicClusteringCommands } from "../../app/topic.infrastructure.ts";
import type { TopicClusteringDatabase } from "./prisma.topic-clustering.repository.ts";
import { PrismaTopicClusteringRunHistoryProjectionRepository } from "./prisma.topic-clustering-run-history-projection.repository.ts";
import { PrismaTopicClusteringRunProjectionRepository } from "./prisma.topic-clustering-run-projection.repository.ts";
import { PrismaTopicModelProjectionRepository } from "./prisma.topic-model-projection.repository.ts";
import { PostgresTopicRepositories } from "./prisma.topic.repositories.ts";
import type { TopicClusteringRepository } from "../topic-clustering.repository.ts";
import type { TopicClusteringRunHistoryData } from "../../projections/topic-clustering-run-history.projection.ts";
import type { TopicClusteringRunStatusData } from "../../projections/topic-clustering-run-status.projection.ts";
import type { TopicModelData } from "../../projections/topic-model.projection.ts";
import { TopicService } from "../../services/topic.service.ts";
import { nowInstant } from "@langwatch/time";

/** The clustering pipeline's Postgres persistence, keyed as the registry expects it. */
export interface TopicClusteringPersistence {
  topicClusteringRunStatus: StateProjectionStore<TopicClusteringRunStatusData>;
  topicClusteringRunHistory: StateProjectionStore<TopicClusteringRunHistoryData>;
  topicModel: StateProjectionStore<TopicModelData>;
  /** The runner's and boot migration's private repository. */
  repository: TopicClusteringRepository;
}

/** Technical dependencies supplied by API/worker composition for Topic execution. */
export interface TopicClusteringExecutionDependencies {
  resolveClickHouseClient: TopicClusteringClickHouseResolver;
  models: TopicClusteringModels;
  langevals: TopicClusteringLangevals;
  langevalsEndpoint: string | null;
  observePayloadSize(kind: TopicClusteringLangevalsKind, sizeBytes: number): void;
}

export interface TopicServerInstallerDependencies {
  database: TopicClusteringDatabase;
  processStore: ProcessStore;
  redis: Redis | Cluster | null;
  execution: TopicClusteringExecutionDependencies;
  metrics: TopicClusteringMetrics;
}

/** Builds Topic's read service, pipeline, runner, and boot seeds as one graph. */
export class PrismaTopicServerInstallerRepository {
  static create(options: TopicServerInstallerDependencies): PrismaTopicServerInstallerRepository {
    return new PrismaTopicServerInstallerRepository(options);
  }

  readonly service: TopicApi;
  readonly persistence: TopicClusteringPersistence;
  readonly runPort: TopicClusteringRun;

  private readonly commands = new EventingTopicClusteringCommandsAdapter();
  private readonly outcomes = new EventingTopicClusteringOutcomeCommandsAdapter();
  private readonly traceAssignments = new UnconnectedTraceTopicAssignment();
  private readonly migration: LegacyImportTopicClusteringMigration;
  private installed = false;

  private constructor(private readonly dependencies: TopicServerInstallerDependencies) {
    const database = dependencies.database;
    const repositories = PostgresTopicRepositories.create({ prisma: database });
    this.persistence = {
      topicClusteringRunStatus: PrismaTopicClusteringRunProjectionRepository.create({ database }),
      topicClusteringRunHistory: PrismaTopicClusteringRunHistoryProjectionRepository.create({
        database,
      }),
      topicModel: PrismaTopicModelProjectionRepository.create({ database }),
      repository: repositories.clustering,
    };
    this.service = TopicService.create({
      repository: repositories.topics,
      schedule: EventingTopicClusteringScheduleAdapter.create({
        processStore: dependencies.processStore,
      }),
    });
    this.migration = LegacyImportTopicClusteringMigration.create({
      repository: this.persistence.repository,
      redis: dependencies.redis,
      commands: this.commands,
    });
    const runnerDependencies: TopicClusteringRunnerDeps = {
      ...dependencies.execution,
      repository: this.persistence.repository,
      migration: this.migration,
      commands: this.commands,
      traceAssignments: this.traceAssignments,
    };
    this.runPort = TopicClusteringRunner.create(runnerDependencies);
  }

  install(options: { eventSourcing: EventSourcing; traceAssignments: TraceTopicAssignment }) {
    if (this.installed) throw new Error("Topic clustering pipeline is already installed");
    this.installed = true;

    this.traceAssignments.connect(options.traceAssignments);
    const pipeline = options.eventSourcing.register(
      createTopicClusteringProcessingPipeline(this.pipelineDependencies()),
    );
    this.commands.connect({
      recordTopics: pipeline.commands.recordTopics,
      requestClustering: pipeline.commands.requestClustering,
    });
    this.outcomes.connect({
      recordClusteringRunStarted: pipeline.commands.recordClusteringRunStarted,
      recordClusteringRunCompleted: pipeline.commands.recordClusteringRunCompleted,
      recordClusteringRunFailed: pipeline.commands.recordClusteringRunFailed,
    });
    const bootstrap = this.dependencies.redis
      ? RedisTopicClusteringBootstrapRepository.create({
          redis: this.dependencies.redis,
          commands: this.commands,
        })
      : null;
    return {
      pipeline,
      claimAndBootstrap: (projectId: string) =>
        bootstrap
          ? bootstrap.claimAndBootstrap(projectId)
          : this.commands.requestClustering({
              tenantId: projectId,
              occurredAt: nowInstant().epochMilliseconds,
              trigger: "bootstrap",
            }),
    };
  }

  startBootSeeds(): void {
    this.migration.startBootSeeds();
  }

  get commandDispatch(): TopicClusteringCommands {
    return this.commands;
  }

  private pipelineDependencies(): TopicClusteringProcessingPipelineDeps {
    return {
      topicClusteringRunStatusStore: this.persistence.topicClusteringRunStatus,
      topicClusteringRunHistoryStore: this.persistence.topicClusteringRunHistory,
      topicModelStore: this.persistence.topicModel,
      dispatch: {
        runPort: this.runPort,
        commands: this.outcomes,
        classifyError: classifyClusteringError,
        metrics: this.dependencies.metrics,
      },
    };
  }
}

class UnconnectedTraceTopicAssignment extends TraceTopicAssignment {
  private delegate: TraceTopicAssignment | null = null;

  connect(delegate: TraceTopicAssignment): void {
    this.delegate = delegate;
  }

  assignTopic(input: AssignTopicCommandData): Promise<void> {
    if (!this.delegate) throw new Error("Trace topic assignment used before pipeline registration");
    return this.delegate.assignTopic(input);
  }
}
