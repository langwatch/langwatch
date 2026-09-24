import { EvaluationApi } from "@langwatch/evaluation-contract";
import type { EventingCommands } from "@langwatch/eventing";
import type { FeatureSetup } from "@langwatch/kernel";
import { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { Instant } from "@langwatch/time";
import type {
  Topic,
  TopicApi,
  TopicClusteringRunHistoryEntry,
  TopicClusteringRequestInput,
  TopicClusteringStatus,
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
import { OtelTopicClusteringMetricsService } from "../services/topic-clustering-metrics.service.ts";
import { ModelProviderTopicClusteringModelsService } from "../services/topic-clustering-models.service.ts";
import { EventingTopicClusteringScheduleService } from "../services/topic-clustering-schedule.service.ts";
import { TopicService } from "../services/topic.service.ts";

/** Eventing-owned schedule read needed by the Topic status projection. */
export interface TopicClusteringScheduleReader {
  findNextWakeAt(input: { projectId: string }): Promise<Instant | null>;
}

type TopicSetup = FeatureSetup<typeof TopicApp.dependencies, never, undefined, TopicRepositories>;

export class TopicApp implements TopicApi {
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
  readonly #pipeline: TopicClusteringProcessingPipelineDefinition;

  private constructor(parts: {
    topics: TopicService;
    commands: EventingTopicClusteringCommandsService;
    outcomes: EventingTopicClusteringOutcomeCommandsService;
    bootstrap: TopicClusteringBootstrapService;
    pipeline: TopicClusteringProcessingPipelineDefinition;
  }) {
    this.#topics = parts.topics;
    this.#commands = parts.commands;
    this.#outcomes = parts.outcomes;
    this.#bootstrap = parts.bootstrap;
    this.#pipeline = parts.pipeline;
  }

  static create(setup: TopicSetup): TopicApp {
    const { repositories, dependencies } = setup;
    const commands = EventingTopicClusteringCommandsService.create();
    const outcomes = EventingTopicClusteringOutcomeCommandsService.create();
    const metrics = OtelTopicClusteringMetricsService.create();
    const migration = LegacyImportTopicClusteringMigration.create({
      repository: repositories.clustering,
      claims: repositories.claims,
      commands,
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

    return new TopicApp({
      topics: TopicService.create({
        repository: repositories.topics,
        schedule: EventingTopicClusteringScheduleService.create({
          processStore: repositories.processStore,
        }),
      }),
      commands,
      outcomes,
      bootstrap: TopicClusteringBootstrapService.create({
        claims: repositories.claims,
        commands,
      }),
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
