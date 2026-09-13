import type {
  Topic,
  TopicApi,
  TopicClusteringRunHistoryEntry,
  TopicClusteringStatus,
  TopicNamesInput,
  TopicProjectInput,
} from "@langwatch/topic-contract";
import { TopicApi as TopicApiToken } from "@langwatch/topic-contract";
import type { Instant } from "@langwatch/time";
import type { FeatureSetup } from "@langwatch/runtime-composition";
import { reads, type MembersRead } from "@langwatch/infrastructure/members";
import { PrismaProcessStore } from "@langwatch/eventing/server";
import type { TopicRepositories } from "../repositories/topic.repositories.ts";
import { TopicService } from "../services/topic.service.ts";
import { EventingTopicClusteringScheduleAdapter } from "../services/topic-clustering-schedule.service.ts";

/** Eventing-owned schedule read needed by the Topic status projection. */
export interface TopicClusteringScheduleReader {
  findNextWakeAt(input: { projectId: string }): Promise<Instant | null>;
}

type TopicSetup = FeatureSetup<
  Record<never, never>,
  MembersRead<typeof TopicApp.reads>,
  undefined,
  TopicRepositories
>;

export class TopicApp implements TopicApi {
  static readonly contract = TopicApiToken;
  static readonly dependencies = {};
  /**
   * The durable clustering wake the status panel reads: a process-manager
   * instance row, kept in the same Postgres this process already holds.
   * Built here, over `prisma`, the way identity builds its pipelines over
   * `eventing` — no separate `schedule` infrastructure member exists, so the
   * old per-role split (worker builds an eventing-backed reader, the api
   * process fakes "not scheduled") is gone: every process that installs
   * Topic now reads the same durable row. The staleness clock (`now`) is not
   * read here at all — `TopicService` already defaults it to `Date.now`, and
   * no deleted composition ever overrode it.
   */
  static readonly reads = reads("prisma");

  readonly #topics: TopicService;

  private constructor(topics: TopicService) {
    this.#topics = topics;
  }

  static create(setup: TopicSetup): TopicApp {
    return new TopicApp(
      TopicService.create({
        repository: setup.repositories.topics,
        schedule: EventingTopicClusteringScheduleAdapter.create({
          processStore: PrismaProcessStore.create({ database: setup.members.prisma }),
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
