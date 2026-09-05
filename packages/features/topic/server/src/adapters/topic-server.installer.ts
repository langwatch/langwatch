import type { ProcessStore } from "@langwatch/eventing";
import { EventSourcing } from "@langwatch/eventing";
import type { TopicClusteringModelsPort, TopicService } from "@langwatch/topic-contract";
import { type AssignTopicCommandData, TraceTopicAssignmentPort } from "@langwatch/trace-contract";
import type { Cluster, Redis } from "ioredis";
import {
  EventingTopicClusteringCommandsAdapter,
  EventingTopicClusteringOutcomeCommandsAdapter,
} from "./eventing.topic-clustering-commands.adapter";
import { EventingTopicClusteringScheduleAdapter } from "./eventing.topic-clustering-schedule.adapter";
import {
  createTopicClusteringProcessingPipeline,
  type TopicClusteringProcessingPipelineDeps,
} from "./eventing.topic-clustering.adapter";
import { PostgresTopicAdapter, type TopicClusteringPersistence } from "./postgres.topic.adapter";
import { RedisTopicClusteringBootstrapAdapter } from "./redis.topic-clustering-bootstrap.adapter";
import {
  classifyClusteringError,
  type TopicClusteringMetricsPort,
  type TopicClusteringRunPort,
} from "../intents/topic-clustering.intent";
import {
  TopicClusteringRunner,
  type TopicClusteringRunnerDeps,
} from "../intents/topic-clustering-runner.intent";
import { LegacyImportTopicClusteringMigration } from "../migrations/legacy-import.topic-clustering.migration";
import type { TopicClusteringClickHouseResolver } from "../ports/topic-clustering-clickhouse.port";
import type {
  TopicClusteringLangevalsKind,
  TopicClusteringLangevalsPort,
} from "../ports/topic-clustering-langevals.port";
import type { TopicClusteringCommandsPort } from "../ports/topic-clustering-commands.port";
import type { TopicClusteringDatabase } from "../repositories/prisma/prisma.topic-clustering.repository";

/** Technical dependencies supplied by API/worker composition for Topic execution. */
export interface TopicClusteringExecutionDependencies {
  resolveClickHouseClient: TopicClusteringClickHouseResolver;
  models: TopicClusteringModelsPort;
  langevals: TopicClusteringLangevalsPort;
  langevalsEndpoint: string | null;
  observePayloadSize(kind: TopicClusteringLangevalsKind, sizeBytes: number): void;
}

export interface TopicServerInstallerDependencies {
  database: TopicClusteringDatabase;
  processStore: ProcessStore;
  redis: Redis | Cluster | null;
  execution: TopicClusteringExecutionDependencies;
  metrics: TopicClusteringMetricsPort;
}

/** Builds Topic's read service, pipeline, runner, and boot seeds as one graph. */
export class TopicServerInstaller {
  static create(options: TopicServerInstallerDependencies): TopicServerInstaller {
    return new TopicServerInstaller(options);
  }

  readonly service: TopicService;
  readonly persistence: TopicClusteringPersistence;
  readonly runPort: TopicClusteringRunPort;

  private readonly commands = new EventingTopicClusteringCommandsAdapter();
  private readonly outcomes = new EventingTopicClusteringOutcomeCommandsAdapter();
  private readonly traceAssignments = new UnconnectedTraceTopicAssignmentPort();
  private readonly migration: LegacyImportTopicClusteringMigration;
  private installed = false;

  private constructor(private readonly dependencies: TopicServerInstallerDependencies) {
    this.persistence = PostgresTopicAdapter.createClusteringPersistence({
      database: dependencies.database,
    });
    this.service = PostgresTopicAdapter.create({
      database: dependencies.database,
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

  install(options: { eventSourcing: EventSourcing; traceAssignments: TraceTopicAssignmentPort }) {
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
      ? RedisTopicClusteringBootstrapAdapter.create({
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
              occurredAt: Date.now(),
              trigger: "bootstrap",
            }),
    };
  }

  startBootSeeds(): void {
    this.migration.startBootSeeds();
  }

  get commandDispatch(): TopicClusteringCommandsPort {
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

class UnconnectedTraceTopicAssignmentPort extends TraceTopicAssignmentPort {
  private delegate: TraceTopicAssignmentPort | null = null;

  connect(delegate: TraceTopicAssignmentPort): void {
    this.delegate = delegate;
  }

  assignTopic(input: AssignTopicCommandData): Promise<void> {
    if (!this.delegate) throw new Error("Trace topic assignment used before pipeline registration");
    return this.delegate.assignTopic(input);
  }
}
