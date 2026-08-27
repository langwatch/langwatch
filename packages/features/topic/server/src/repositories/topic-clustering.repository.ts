/**
 * Private persistence capability for the clustering runner and the boot
 * migration: project existence, the topic model rows the runner pages
 * against, the cost ledger, and the pre-cutover seed reads. Implemented by
 * the Prisma repository; composition hands it the guarded client.
 */

/** Topic identity + age rows behind the mode decision and cadence gate. */
export interface TopicClusteringTopicIndexRow {
  id: string;
  parentId: string | null;
  createdAt: Date;
}

/** One model topic/subtopic row as the incremental clustering call needs it. */
export interface TopicClusteringModelRow {
  id: string;
  name: string;
  centroid: number[];
  p95Distance: number;
  parentId: string | null;
}

/** A full pre-ownership Topic row, recorded onto the stream by the seed. */
export interface TopicClusteringSeedTopicRow {
  id: string;
  name: string;
  parentId: string | null;
  embeddingsModel: string;
  centroid: number[];
  p95Distance: number;
  automaticallyGenerated: boolean;
  createdAt: Date;
}

export abstract class TopicClusteringRepository {
  /** The project's existence; the runner reports a missing project itself. */
  abstract tryFindProject(projectId: string): Promise<{ id: string } | null>;

  /** Every topic id/parent/age for the project (light index rows). */
  abstract findTopicIndexRows(projectId: string): Promise<TopicClusteringTopicIndexRow[]>;

  /** The current top-level model topics (centroids), for incremental runs. */
  abstract findModelTopics(projectId: string): Promise<TopicClusteringModelRow[]>;

  /** The current model subtopics (centroids), for incremental runs. */
  abstract findModelSubtopics(projectId: string): Promise<TopicClusteringModelRow[]>;

  /** The clustering call's cost row (CostType.CLUSTERING on the project). */
  abstract recordClusteringCost(params: {
    projectId: string;
    amount: number;
    currency: "USD" | "EUR";
    tracesCount: number;
    topicsCount: number;
    subtopicsCount: number;
    isIncremental: boolean;
  }): Promise<void>;

  /**
   * The projection cursor row, when the stream already owns this project's
   * topic model — the seed's ownership check.
   */
  abstract tryFindTopicModelCursor(projectId: string): Promise<{ id: string } | null>;

  /** A project's full pre-ownership Topic rows, for the seed event. */
  abstract findSeedTopicRows(projectId: string): Promise<TopicClusteringSeedTopicRow[]>;

  /**
   * One page of projects that still hold pre-ownership Topic rows, ascending
   * by id, strictly after `afterId`. Keyset paging rather than offset: the
   * walk stays O(1) per page and never repeats a project.
   *
   * Pages the GLOBAL `Project` model — the tenancy guard exempts it (it IS
   * the tenant, addressed by its own id) — filtered to projects that own
   * Topic rows via a `topics: { some }` EXISTS filter. Topic.projectId is a
   * FK, so that is the same set as a distinct-projectId scan of `Topic`.
   */
  abstract findProjectsWithTopicsPage(params: {
    afterId: string | null;
    take: number;
  }): Promise<{ id: string }[]>;

  /**
   * One page of eligible projects (past their first message), ascending by
   * id, strictly after `afterId`. It CAN miss a project inserted mid-walk
   * with an id lexically behind the cursor (ids are nanoid, not monotonic) —
   * harmless here, because a project created after the walk started has
   * `firstMessage: false` and gets its schedule from the projectMetadata
   * subscriber's bootstrap on first trace, not from this walk.
   */
  abstract findEligibleProjectsPage(params: {
    afterId: string | null;
    take: number;
  }): Promise<{ id: string }[]>;

  /** The subset that already has a topic-model cursor row. */
  abstract findOwnedTopicModelProjectIds(projectIds: string[]): Promise<string[]>;

  /**
   * The subset of `projectIds` that already has a scheduled topic clustering
   * wake. Those are skipped: re-requesting is a harmless no-op, but on a
   * large fleet it would append an event per project on every pass.
   */
  abstract findAlreadyScheduledProjectIds(projectIds: string[]): Promise<string[]>;
}
