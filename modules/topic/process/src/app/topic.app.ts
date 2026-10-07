import { EvaluationApi } from "@langwatch/evaluation-contract";
import type { EventingCommands } from "@langwatch/eventing";
import { ModelProviderApi } from "@langwatch/model-provider-contract";
import { createLogger } from "@langwatch/observability";
import type { FeatureSetup } from "@langwatch/process";
import { nowInstant, type Instant } from "@langwatch/time";
import type {
  Topic,
  TopicApi,
  TopicClusteringRunHistoryEntry,
  TopicClusteringRequestInput,
  TopicClusteringStatus,
  TopicClusteringTriggerResult,
  TopicNamesInput,
  TopicProjectInput,
} from "@langwatch/topic-contract";
import { TopicApi as TopicApiToken } from "@langwatch/topic-contract";
import { TraceApi } from "@langwatch/trace-contract";

import {
  createTopicClusteringProcessingPipeline,
  type TopicClusteringProcessingPipelineDefinition,
} from "../eventing/topic-clustering-processing.pipeline.ts";
import { TopicClusteringRunner } from "../eventing/topic-clustering-runner.intent.ts";
import { classifyClusteringError } from "../eventing/topic-clustering.intent.ts";
import { LegacyImportTopicClusteringMigration } from "../migrations/legacy-import.topic-clustering.migration.ts";
import type { TopicRepositories } from "../repositories/topic.repositories.ts";
import { TopicClusteringBootstrapService } from "../services/topic-clustering-bootstrap.service.ts";
import {
  EventingTopicClusteringCommandsService,
  EventingTopicClusteringOutcomeCommandsService,
} from "../services/topic-clustering-commands.service.ts";
import { TopicClusteringManualRunService } from "../services/topic-clustering-manual-run.service.ts";
import { OtelTopicClusteringMetricsService } from "../services/topic-clustering-metrics.service.ts";
import { ModelProviderTopicClusteringModelsService } from "../services/topic-clustering-models.service.ts";
import { EventingTopicClusteringScheduleService } from "../services/topic-clustering-schedule.service.ts";
import { TopicClusteringTriggerService } from "../services/topic-clustering-trigger.service.ts";
import { TopicService } from "../services/topic.service.ts";
import type { TopicBrowserApi } from "../transport/topic.trpc.ts";

/** Eventing-owned schedule read needed by the Topic status projection. */
export interface TopicClusteringScheduleReader {
  findNextWakeAt(input: { projectId: string }): Promise<Instant | null>;
}

const triggerLogger = createLogger("langwatch:topic:clustering-trigger");

type TopicSetup = FeatureSetup<
  typeof TopicModule.dependencies,
  never,
  undefined,
  TopicRepositories
>;

export class TopicModule implements TopicApi, TopicBrowserApi {
  static readonly contract = TopicApiToken;
  static readonly dependencies = {
    evaluations: EvaluationApi,
    traces: TraceApi,
    modelProviders: ModelProviderApi,
  };

  readonly #topics: TopicService;
  readonly #commands: EventingTopicClusteringCommandsService;
  readonly #outcomes: EventingTopicClusteringOutcomeCommandsService;
  readonly #bootstrap: TopicClusteringBootstrapService;
  readonly #manualRun: TopicClusteringManualRunService;
  readonly #trigger: TopicClusteringTriggerService;
  readonly #pipeline: TopicClusteringProcessingPipelineDefinition;

  private constructor(parts: {
    topics: TopicService;
    commands: EventingTopicClusteringCommandsService;
    outcomes: EventingTopicClusteringOutcomeCommandsService;
    bootstrap: TopicClusteringBootstrapService;
    manualRun: TopicClusteringManualRunService;
    pipeline: TopicClusteringProcessingPipelineDefinition;
  }) {
    this.#trigger = TopicClusteringTriggerService.create({
      clustering: this,
      reportFailure: (error, { projectId }) =>
        triggerLogger.error({ error, projectId }, "Topic clustering request failed."),
      now: () => nowInstant().epochMilliseconds,
    });
    this.#topics = parts.topics;
    this.#commands = parts.commands;
    this.#outcomes = parts.outcomes;
    this.#bootstrap = parts.bootstrap;
    this.#manualRun = parts.manualRun;
    this.#pipeline = parts.pipeline;
  }

  static create(setup: TopicSetup): TopicModule {
    const { repositories, dependencies } = setup;
    const commands = EventingTopicClusteringCommandsService.create();
    const outcomes = EventingTopicClusteringOutcomeCommandsService.create();
    const metrics = OtelTopicClusteringMetricsService.create();
    const schedule = EventingTopicClusteringScheduleService.create({
      processStore: repositories.processStore,
    });
    const migration = LegacyImportTopicClusteringMigration.create({
      repository: repositories.clustering,
      claims: repositories.claims,
      commands,
      schedule,
    });
    const runner = TopicClusteringRunner.create({
      traces: dependencies.traces,
      models: ModelProviderTopicClusteringModelsService.create({
        modelProviders: dependencies.modelProviders,
      }),
      evaluations: dependencies.evaluations,
      repository: repositories.clustering,
      migration,
      commands,
      observePayloadSize: (kind, sizeBytes) => metrics.observePayloadSize(kind, sizeBytes),
    });

    return new TopicModule({
      topics: TopicService.create({
        repository: repositories.topics,
        schedule,
      }),
      commands,
      outcomes,
      bootstrap: TopicClusteringBootstrapService.create({
        claims: repositories.claims,
        commands,
      }),
      manualRun: TopicClusteringManualRunService.create({ runner }),
      pipeline: createTopicClusteringProcessingPipeline({
        topicClusteringRunStatusStore: repositories.runStatus,
        topicClusteringRunHistoryStore: repositories.runHistory,
        topicModelStore: repositories.topicModel,
        dispatch: {
          runPort: runner,
          commands: outcomes,
          classifyError: classifyClusteringError,
          metrics,
        },
        seeds: migration,
      }),
    });
  }

  /** This module's own application, which the browser door reads through. */
  topics(): TopicApi {
    return this;
  }

  triggerTopicClustering(input: {
    projectId: string;
    by: Readonly<{ id: string }>;
  }): Promise<TopicClusteringTriggerResult> {
    return this.#trigger.trigger(input);
  }

  /** The pipeline `topic_clustering_processing` registers, built once by {@link create}. */
  eventingPipeline(): TopicClusteringProcessingPipelineDefinition {
    return this.#pipeline;
  }

  /** Binds the registered pipeline's own senders; every clustering write goes through them. */
  connectCommands(commands: EventingCommands<TopicClusteringProcessingPipelineDefinition>): void {
    this.#commands.connect({
      recordTopics: commands.recordTopics,
      requestClustering: commands.requestClustering,
    });
    this.#outcomes.connect({
      recordClusteringRunStarted: commands.recordClusteringRunStarted,
      recordClusteringRunCompleted: commands.recordClusteringRunCompleted,
      recordClusteringRunFailed: commands.recordClusteringRunFailed,
    });
  }

  requestClustering(input: TopicClusteringRequestInput): Promise<void> {
    const { projectId, ...request } = input;
    return this.#commands.requestClustering({ tenantId: projectId, ...request });
  }

  bootstrapClustering(input: TopicProjectInput): Promise<void> {
    return this.#bootstrap.bootstrap(input);
  }

  /** The tasks role's manual walk over every clustering page for one project. */
  runClusteringForProject(input: TopicProjectInput): Promise<void> {
    return this.#manualRun.run(input);
  }

  getAll(input: TopicProjectInput): Promise<Topic[]> {
    return this.#topics.getAll(input);
  }

  getNamesByIds(input: TopicNamesInput): Promise<Map<string, string>> {
    return this.#topics.getNamesByIds(input);
  }

  getClusteringStatus(input: TopicProjectInput): Promise<TopicClusteringStatus> {
    return this.#topics.getClusteringStatus(input);
  }

  getClusteringRunHistory(input: TopicProjectInput): Promise<TopicClusteringRunHistoryEntry[]> {
    return this.#topics.getClusteringRunHistory(input);
  }
}
