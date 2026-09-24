import { EvaluationApi } from "@langwatch/evaluation-contract";
import type { FeatureSetup } from "@langwatch/kernel";
import type { Instant } from "@langwatch/time";
import type {
  Topic,
  TopicApi,
  TopicClusteringRunHistoryEntry,
  TopicClusteringStatus,
  TopicNamesInput,
  TopicProjectInput,
} from "@langwatch/topic-contract";
import { TopicApi as TopicApiToken } from "@langwatch/topic-contract";

import type { TopicRepositories } from "../repositories/topic.repositories.ts";
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
  };

  readonly #topics: TopicService;

  private constructor(topics: TopicService) {
    this.#topics = topics;
  }

  static create(setup: TopicSetup): TopicApp {
    return new TopicApp(
      TopicService.create({
        repository: setup.repositories.topics,
        schedule: EventingTopicClusteringScheduleService.create({
          processStore: setup.repositories.processStore,
        }),
      }),
    );
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
