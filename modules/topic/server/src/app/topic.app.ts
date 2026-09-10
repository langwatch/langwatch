import type {
  Topic,
  TopicApi,
  TopicClusteringRunHistoryEntry,
  TopicClusteringStatus,
  TopicNamesInput,
  TopicProjectInput,
} from "@langwatch/topic-contract";
import { TopicApi as TopicApiToken } from "@langwatch/topic-contract";
import type { FeatureSetup } from "@langwatch/runtime-composition";
import type { TopicClusteringScheduleRepository } from "../repositories/topic-clustering-schedule.repository.ts";
import type { TopicRepositories } from "../repositories/topic.repositories.ts";
import { TopicService } from "../services/topic.service.ts";

/**
 * The durable schedule the status panel reads its next wake from, and the
 * clock the staleness rules are measured against. Both belong to the process:
 * eventing owns the schedule, and a test owns time.
 */
export type TopicInfrastructure = Readonly<{
  schedule: TopicClusteringScheduleRepository;
  now?: (() => number) | undefined;
}>;

type TopicSetup = FeatureSetup<
  Record<never, never>,
  TopicInfrastructure,
  undefined,
  TopicRepositories
>;

export class TopicApp implements TopicApi {
  static readonly contract = TopicApiToken;
  static readonly dependencies = {};

  readonly #topics: TopicService;

  private constructor(topics: TopicService) {
    this.#topics = topics;
  }

  static create(setup: TopicSetup): TopicApp {
    return new TopicApp(
      TopicService.create({
        repository: setup.repositories.topics,
        schedule: setup.infrastructure.schedule,
        now: setup.infrastructure.now,
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
